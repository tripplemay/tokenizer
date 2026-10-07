// Old-B06 rowless invalid_json fallback: bisection, good-neighbour protection,
// singleton proof via empty probe, global-failure distinction.
// argv: <case: poison-row|global-failure> <home>
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { startStub, mkhome, event, check, summary, type StubPlan } from "./harness";

const [caseName, home] = process.argv.slice(2);

// A batch "contains structural poison" if it carries the poison event id.
const hasPoison = (json: any) => Array.isArray(json?.events) &&
  json.events.some((e: any) => e.sourceEventId === "poison-1");

const plans: Record<string, StubPlan> = {
  // Old B06 server: structural poison -> rowless invalid_json (cannot locate).
  "poison-row": (json) => {
    if (hasPoison(json)) return [400, { error: "invalid batch request", code: "invalid_json" }];
    return [200, { inserted: json.events.length, duplicates: 0, received: json.events.length, deviceId: "dev_stub" }];
  },
  // Same rowless code for EVERYTHING including the empty probe: the failure is
  // global (envelope/auth/infra), not row-specific.
  "global-failure": () => [400, { error: "invalid batch request", code: "invalid_json" }]
};

async function main() {
  const stub = await startStub(plans[caseName]);
  mkhome(home, stub.url);
  const { writeQueue, readQueue } = await import("@/cli/queue");
  const { syncEvents } = await import("@/cli/sync");
  const { readConfig } = await import("@/cli/config");
  const { readRejectedUsageEvents } = await import("@/cli/rejected-events");

  // G1 newest, poison middle, G2 oldest.
  const events = [event("good-1", {}, 3), event("poison-1", {}, 2), event("good-2", {}, 1)];
  writeQueue(events);

  let result: Awaited<ReturnType<typeof syncEvents>> | null = null;
  let threw: unknown = null;
  const started = Date.now();
  try { result = await syncEvents(readConfig(), readQueue()); }
  catch (error) { threw = error; }
  const elapsed = Date.now() - started;
  stub.server.close();

  const queueFile = join(home, ".tokenizer", "queue.jsonl");
  const queueAfter = existsSync(queueFile) ? readFileSync(queueFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
  const rejectedFile = join(home, ".tokenizer", "rejected-usage.jsonl");
  let quarantine: Array<{ code: string; event: { sourceEventId: string } }> = [];
  try { quarantine = readRejectedUsageEvents(rejectedFile); } catch { /* absent */ }
  const sizes = stub.requests.map((r) => (r.json as any)?.events?.length ?? "?");

  if (caseName === "poison-row") {
    console.log("INFO: request sizes =", sizes.join(","));
    check("no throw", threw === null, String(threw));
    check("poison quarantined with rowless code", quarantine.length === 1 &&
      quarantine[0].event.sourceEventId === "poison-1" && quarantine[0].code === "invalid_json",
      JSON.stringify(quarantine));
    check("good neighbours NOT quarantined", !quarantine.some((r) => r.event.sourceEventId.startsWith("good-")));
    check("good neighbours uploaded", result?.received === 2, JSON.stringify(result));
    check("rejected count surfaced", result?.rejected === 1);
    check("queue fully drained", queueAfter.length === 0, JSON.stringify(queueAfter));
    check("bisected (never sent singletons of good rows before narrowing)",
      sizes[0] === 3 && sizes.length >= 4, sizes.join(","));
    const empties = stub.requests.filter((r) => (r.json as any)?.events?.length === 0).length;
    check("singleton proof used exactly one empty probe", empties === 1, `empties=${empties}`);
    check("no transient backoff", elapsed < 4000, `${elapsed}ms`);
  } else {
    check("global failure surfaces as error", threw !== null);
    check("nothing quarantined on global failure", quarantine.length === 0, JSON.stringify(quarantine));
    check("all 3 rows stay active (no silent loss of good neighbours)", queueAfter.length === 3,
      JSON.stringify(queueAfter.map((e) => e.sourceEventId)));
    const empties = stub.requests.filter((r) => (r.json as any)?.events?.length === 0).length;
    check("empty probe was attempted as proof and failed too", empties === 1, `empties=${empties}`);
  }
  summary(caseName);
}

main();
