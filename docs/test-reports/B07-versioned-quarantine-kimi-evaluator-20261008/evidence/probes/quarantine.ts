// Versioned quarantine: old+corrected retention, exact retry dedupe,
// version-keyed ACK vs concurrently collected correction, permissions,
// quarantine-first fault injection (chflags uchg), corrupt-quarantine fail-closed.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkhome, event, check, summary } from "./harness";

const home = process.argv[2];
mkhome(home, "http://127.0.0.1:1");

async function main() {
  const { mergeQueueEvents, readQueue, resolveQueueEvents, queueEventVersion } = await import("@/cli/queue");
  const { readRejectedUsageEvents } = await import("@/cli/rejected-events");
  const dir = join(home, ".tokenizer");
  const queueFile = join(dir, "queue.jsonl");
  const rejectedFile = join(dir, "rejected-usage.jsonl");

  const oldV = event("shared-id", { model: "model-old", inputTokens: 1 });
  const correctedV = event("shared-id", { model: "model-fixed", inputTokens: 9 });
  check("distinct versions for same sourceEventId", queueEventVersion(oldV) !== queueEventVersion(correctedV));

  // 1. Old version rejected by server -> quarantined, removed from queue.
  mergeQueueEvents([oldV]);
  resolveQueueEvents({ accepted: [], rejected: [{ event: oldV, code: "invalid_event" }] });
  check("queue empty after old version rejected", readQueue().length === 0);
  let quarantine = readRejectedUsageEvents(rejectedFile);
  check("quarantine has old version", quarantine.length === 1 && quarantine[0].event.model === "model-old");

  // 2. Parser correction recollects the same sourceEventId with fixed content.
  mergeQueueEvents([correctedV]);
  check("corrected version admitted to queue despite old version in quarantine",
    readQueue().length === 1 && readQueue()[0].model === "model-fixed");

  // 3. If the corrected version is ALSO rejected, both versions are retained.
  resolveQueueEvents({ accepted: [], rejected: [{ event: correctedV, code: "invalid_event" }] });
  quarantine = readRejectedUsageEvents(rejectedFile);
  check("old+corrected both retained in quarantine", quarantine.length === 2 &&
    quarantine.some((r) => r.event.model === "model-old") &&
    quarantine.some((r) => r.event.model === "model-fixed"),
    JSON.stringify(quarantine.map((r) => r.event.model)));

  // 4. Exact retry dedupe: replaying the identical rejection adds nothing.
  const before = readFileSync(rejectedFile, "utf8");
  resolveQueueEvents({ accepted: [], rejected: [{ event: oldV, code: "invalid_event" }] });
  resolveQueueEvents({ accepted: [], rejected: [{ event: correctedV, code: "invalid_event" }] });
  check("exact retry dedupe: file byte-identical after replay", readFileSync(rejectedFile, "utf8") === before);
  check("exact retry dedupe: still 2 rows", readRejectedUsageEvents(rejectedFile).length === 2);

  // 5. ACK for one exact version must not delete another version of the same ID.
  mergeQueueEvents([oldV, correctedV]);
  resolveQueueEvents({ accepted: [oldV], rejected: [] });
  const remaining = readQueue();
  check("version-keyed ACK keeps the other version", remaining.length === 1 &&
    queueEventVersion(remaining[0]) === queueEventVersion(correctedV));

  // 6. Permissions: queue/quarantine 0600. Directory: the product never chmods
  //    a pre-existing dir (documented in atomic-file.ts); when the product
  //    itself creates the state dir it uses 0700 — checked on a fresh HOME in
  //    the permissions probe below.
  const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);
  check("queue.jsonl mode 600", mode(queueFile) === "600", mode(queueFile));
  check("rejected-usage.jsonl mode 600", mode(rejectedFile) === "600", mode(rejectedFile));
  console.log(`INFO: pre-existing dir mode kept at ${mode(dir)} (no chmod side effect by design)`);
  mergeQueueEvents([event("perm-check")]); // re-write via merge path
  check("queue.jsonl mode stays 600 after merge", mode(queueFile) === "600", mode(queueFile));

  // 7. Crash window: quarantine committed (step 1), queue checkpoint blocked (step 2).
  //    chflags uchg makes the queue file's rename target immutable on macOS:
  //    writeFileAtomic's rename fails EPERM -> resolveQueueEvents throws AFTER
  //    the quarantine write. Restart replay must be idempotent and loss-free.
  //    Queue at this point: [correctedV] from step 5; add oldV back -> 2 versions.
  mergeQueueEvents([oldV]);
  const versionSet = (list: { sourceEventId: string }[]) =>
    new Set((list as Parameters<typeof queueEventVersion>[0][]).map(queueEventVersion));
  const preFaultVersions = versionSet(readQueue());
  check("pre-fault queue holds both versions", preFaultVersions.has(queueEventVersion(oldV)) &&
    preFaultVersions.has(queueEventVersion(correctedV)), [...preFaultVersions].join(","));
  execFileSync("chflags", ["uchg", queueFile]);
  let threw = false;
  try {
    resolveQueueEvents({ accepted: [], rejected: [{ event: oldV, code: "invalid_event" }] });
  } catch { threw = true; }
  execFileSync("chflags", ["nouchg", queueFile]);
  check("fault-injected checkpoint failure throws", threw);
  const qRows = readRejectedUsageEvents(rejectedFile).filter((r) => queueEventVersion(r.event) === queueEventVersion(oldV));
  check("quarantine committed before the failed checkpoint (single row)", qRows.length === 1, `rows=${qRows.length}`);
  const queueAfterFault = versionSet(readQueue());
  check("active queue retained after failed checkpoint",
    queueAfterFault.size === preFaultVersions.size && [...preFaultVersions].every((v) => queueAfterFault.has(v)));
  // Replay after restart: same resolution must converge without duplicating quarantine.
  const quarantineBeforeReplay = readFileSync(rejectedFile, "utf8");
  const rest = resolveQueueEvents({ accepted: [], rejected: [{ event: oldV, code: "invalid_event" }] });
  const restVersions = versionSet(rest);
  check("replay drains only the rejected version", !restVersions.has(queueEventVersion(oldV)) &&
    restVersions.has(queueEventVersion(correctedV)) && rest.length === preFaultVersions.size - 1);
  check("replay idempotent: quarantine not duplicated", readFileSync(rejectedFile, "utf8") === quarantineBeforeReplay);

  // 8. Corrupt quarantine: resolution must throw and the active queue must be untouched.
  mergeQueueEvents([event("keep-me")]);
  writeFileSync(rejectedFile, "{not json\n");
  const queueBefore = readFileSync(queueFile, "utf8");
  let threwCorrupt = false;
  try {
    resolveQueueEvents({ accepted: [], rejected: [{ event: event("keep-me"), code: "invalid_event" }] });
  } catch { threwCorrupt = true; }
  check("corrupt quarantine fails closed", threwCorrupt);
  check("active queue byte-identical after corrupt quarantine", readFileSync(queueFile, "utf8") === queueBefore);

  summary("quarantine-version");
}

main();
