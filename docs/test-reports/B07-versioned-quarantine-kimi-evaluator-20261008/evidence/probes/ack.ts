// Wire/HTTP error classification + ACK ID/version validation.
// One case per process invocation: npx tsx ack.ts <case> <home>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startStub, mkhome, event, check, summary, type StubPlan } from "./harness";

const [caseName, home] = process.argv.slice(2);

const goodPartial = (batch: any[]) => ({
  inserted: batch.length, duplicates: 0, received: batch.length, deviceId: "dev_stub",
  protocol: "usage-partial-v1",
  accepted: batch.map((_, row) => ({ row, source: batch[row].source, sourceEventId: batch[row].sourceEventId })),
  rejected: []
});

const plans: Record<string, StubPlan> = {
  "forged-ack-id": (json) => {
    const ack = goodPartial(json.events);
    ack.accepted[0].sourceEventId = "FORGED";
    return [200, ack];
  },
  "forged-ack-source": (json) => {
    const ack = goodPartial(json.events);
    ack.accepted[0].source = "codex";
    return [200, ack];
  },
  "incomplete-partition": (json) => {
    const ack = goodPartial(json.events);
    ack.accepted = ack.accepted.slice(1); // row 0 never resolved
    ack.received = ack.accepted.length;
    return [200, ack];
  },
  "duplicate-ack-row": (json) => {
    const ack = goodPartial(json.events);
    ack.accepted.push({ ...ack.accepted[0] });
    ack.received = ack.accepted.length;
    return [200, ack];
  },
  "out-of-range-row": (json) => {
    const ack = goodPartial(json.events);
    ack.accepted.push({ row: 99, source: "aider", sourceEventId: "ghost" });
    ack.received = ack.accepted.length;
    return [200, ack];
  },
  "received-mismatch": (json) => {
    const ack = goodPartial(json.events);
    ack.received = ack.accepted.length + 1;
    return [200, ack];
  },
  "protocol-mismatch": (json) => {
    const ack = goodPartial(json.events);
    ack.protocol = "usage-partial-v2";
    return [200, ack];
  },
  "legacy-full-ack": (json) => [200, { inserted: json.events.length, duplicates: 0, received: json.events.length, deviceId: "dev_stub" }],
  "permanent-401": () => [401, { error: "unauthorized" }],
  "permanent-403": () => [403, { error: "forbidden" }],
  "transient-503": () => [503, { error: "busy" }],
  "compat-row-invalid-event": (json, _req, i) => {
    // Previous B06 server: whole-batch 400 naming one permanent row (row 1 = poison), else legacy 200.
    if (i === 0) return [400, { error: "invalid batch request", code: "invalid_event", row: 1 }];
    return [200, { inserted: json.events.length, duplicates: 0, received: json.events.length, deviceId: "dev_stub" }];
  },
  "compat-row-invalid-json": (json, _req, i) => {
    if (i === 0) return [400, { error: "invalid batch request", code: "invalid_json", row: 2 }];
    return [200, { inserted: json.events.length, duplicates: 0, received: json.events.length, deviceId: "dev_stub" }];
  },
  "rowless-invalid-event": () => [400, { error: "invalid batch request", code: "invalid_event" }],
  "rowless-invalid-batch": () => [400, { error: "invalid batch request", code: "invalid_batch" }]
};

async function main() {
  const plan = plans[caseName];
  if (!plan) { console.error("unknown case", caseName); process.exit(2); }
  const stub = await startStub(plan);
  mkhome(home, stub.url);
  const { writeQueue, readQueue } = await import("@/cli/queue");
  const { syncEvents } = await import("@/cli/sync");
  const { readConfig } = await import("@/cli/config");
  const { readRejectedUsageEvents } = await import("@/cli/rejected-events");

  const events = [event("evt-a", {}, 2), event("evt-b", {}, 1), event("evt-c", {}, 0)];
  writeQueue(events);
  const before = readFileSync(join(home, ".tokenizer", "queue.jsonl"), "utf8");

  let result: Awaited<ReturnType<typeof syncEvents>> | null = null;
  let threw: unknown = null;
  const started = Date.now();
  try { result = await syncEvents(readConfig(), readQueue()); }
  catch (error) { threw = error; }
  const elapsed = Date.now() - started;
  stub.server.close();

  const queueAfter = readFileSync(join(home, ".tokenizer", "queue.jsonl"), "utf8");
  const rejectedFile = join(home, ".tokenizer", "rejected-usage.jsonl");
  let quarantine: Array<{ code: string; event: { sourceEventId: string } }> = [];
  try { quarantine = readRejectedUsageEvents(rejectedFile); } catch { /* absent */ }

  const reqs = stub.requests;
  const msg = String((threw as Error)?.message ?? "");

  switch (caseName) {
    case "forged-ack-id":
    case "forged-ack-source":
    case "incomplete-partition":
    case "duplicate-ack-row":
    case "out-of-range-row":
    case "received-mismatch":
    case "protocol-mismatch":
      check(`${caseName}: fails closed`, msg.includes("Invalid partial ACK response"), msg);
      check(`${caseName}: exactly one request (no retry of forged ACK)`, reqs.length === 1, `n=${reqs.length}`);
      check(`${caseName}: queue byte-identical after failure`, queueAfter === before);
      check(`${caseName}: nothing quarantined`, quarantine.length === 0);
      break;
    case "legacy-full-ack":
      check("legacy-full-ack: no throw", threw === null, msg);
      check("legacy-full-ack: queue emptied (full-batch ACK)", queueAfter === "");
      check("legacy-full-ack: one request", reqs.length === 1);
      check("legacy-full-ack: counts", result?.inserted === 3 && result?.received === 3);
      break;
    case "permanent-401":
    case "permanent-403":
      check(`${caseName}: throws`, threw !== null);
      check(`${caseName}: not retried`, reqs.length === 1, `n=${reqs.length}`);
      check(`${caseName}: queue unchanged`, queueAfter === before);
      check(`${caseName}: fast (no 5s/15s backoff)`, elapsed < 4000, `${elapsed}ms`);
      break;
    case "transient-503":
      check("transient-503: throws after bounded retries", threw !== null);
      check("transient-503: exactly 3 attempts", reqs.length === 3, `n=${reqs.length}`);
      check("transient-503: queue unchanged", queueAfter === before);
      console.log(`INFO: transient-503 wall=${elapsed}ms (expect ~20000 for 5s+15s)`);
      check("transient-503: backoff observed", elapsed >= 19000, `${elapsed}ms`);
      break;
    case "compat-row-invalid-event":
    case "compat-row-invalid-json": {
      const row = caseName === "compat-row-invalid-event" ? 1 : 2;
      const poisonId = ["evt-a", "evt-b", "evt-c"][row];
      check(`${caseName}: no throw`, threw === null, msg);
      check(`${caseName}: poison quarantined`, quarantine.length === 1 && quarantine[0].event.sourceEventId === poisonId,
        JSON.stringify(quarantine));
      check(`${caseName}: good rows ACKed, queue empty`, queueAfter === "");
      check(`${caseName}: rejected count surfaced`, result?.rejected === 1);
      check(`${caseName}: second request excludes poison`, reqs.length === 2 &&
        !(reqs[1].json as any).events.some((e: any) => e.sourceEventId === poisonId));
      check(`${caseName}: no transient backoff`, elapsed < 4000, `${elapsed}ms`);
      const goodIds = (reqs[1].json as any).events.map((e: any) => e.sourceEventId).sort();
      check(`${caseName}: good neighbours retried immediately`, JSON.stringify(goodIds) ===
        JSON.stringify(["evt-a", "evt-b", "evt-c"].filter((id) => id !== poisonId).sort()), JSON.stringify(goodIds));
      break;
    }
    case "rowless-invalid-event":
    case "rowless-invalid-batch":
      check(`${caseName}: throws (not a per-row compat response)`, threw !== null);
      check(`${caseName}: queue unchanged (good neighbours not pinned silently lost)`, queueAfter === before);
      check(`${caseName}: nothing quarantined`, quarantine.length === 0);
      check(`${caseName}: one request`, reqs.length === 1, `n=${reqs.length}`);
      break;
  }
  summary(caseName);
}

main();
