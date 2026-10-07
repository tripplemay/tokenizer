// B03: local-only admits to durable queue without network; switching to sync
// does not upload inside configure; backlog uploads at the next sync cycle;
// rule edits do not delete already-admitted backlog.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startStub, mkhome, event, check, summary } from "./harness";

const home = process.argv[2];

async function main() {
  const stub = await startStub((json) =>
    [200, { inserted: json.events.length, duplicates: 0, received: json.events.length, deviceId: "dev_stub" }]);
  mkhome(home, stub.url, "local-only");
  const { writeQueue, readQueue } = await import("@/cli/queue");
  const { syncEvents } = await import("@/cli/sync");
  const { readConfig, configure } = await import("@/cli/config");
  const { describePrivacyBacklog } = await import("@/cli/privacy");

  // Collection in local-only mode: events admitted to the durable queue.
  const backlog = [event("b03-a", { workspacePath: join(home, "project", "a") }, 3),
                   event("b03-b", { workspacePath: join(home, "project", "b") }, 2),
                   event("b03-c", { workspacePath: join(home, "project", "c") }, 1)];
  writeQueue(backlog);
  check("local-only: backlog admitted to durable queue", readQueue().length === 3);

  // syncEvents is gated by upload mode.
  let threw: unknown = null;
  try { await syncEvents(readConfig(), readQueue()); } catch (e) { threw = e; }
  check("local-only: syncEvents refused by privacy mode", String((threw as Error)?.message).includes("disabled by privacy mode"));
  check("local-only: zero network requests", stub.requests.length === 0, `n=${stub.requests.length}`);
  check("local-only: backlog retained", readQueue().length === 3);

  // Switching to sync: configure performs no upload itself.
  configure({ privacyMode: "sync" });
  check("configure(sync): still zero network requests", stub.requests.length === 0, `n=${stub.requests.length}`);
  check("configure(sync): backlog untouched", readQueue().length === 3);
  const desc = describePrivacyBacklog("sync", 3);
  check("status copy discloses backlog + next-cycle upload",
    desc.includes("3 previously admitted events") && desc.includes("next Agent/run/sync cycle"), desc);

  // Rule edit after admission must not delete the admitted backlog.
  configure({ excludePaths: [join(home, "project")] });
  check("exclude rule edit does not delete admitted backlog", readQueue().length === 3);

  // Next sync cycle uploads the previously admitted backlog wholesale.
  const result = await syncEvents(readConfig(), readQueue());
  stub.server.close();
  check("next cycle: all 3 backlog events uploaded", result.received === 3, JSON.stringify(result));
  const sent = stub.requests.flatMap((r) => (r.json as any).events.map((e: any) => e.sourceEventId)).sort();
  check("next cycle: wire carried exactly the admitted IDs",
    JSON.stringify(sent) === JSON.stringify(["b03-a", "b03-b", "b03-c"]), JSON.stringify(sent));
  check("queue drained after upload", readQueue().length === 0);
  const rawQueue = readFileSync(join(home, ".tokenizer", "queue.jsonl"), "utf8");
  check("queue file contains no path payload after drain", rawQueue === "");
  summary("b03-backlog");
}

main();
