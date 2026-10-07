// Child worker: merge own events, then race: resolve an ACK for oldV while
// the sibling concurrently merges correctedV for the same sourceEventId.
// argv: <home> <workerId> <iters>
import { event } from "./harness";

const [home, workerId, itersArg] = process.argv.slice(2);
const iters = Number(itersArg);

async function main() {
  const { mergeQueueEvents, resolveQueueEvents, readQueue, queueEventVersion } = await import("@/cli/queue");
  for (let i = 0; i < iters; i++) {
    const own = event(`w${workerId}-evt-${i}`, { inputTokens: i }, i % 60);
    mergeQueueEvents([own]);
    const oldV = event(`race-${i}`, { model: "m-old" }, 0);
    const correctedV = event(`race-${i}`, { model: "m-fixed" }, 0);
    if (workerId === "0") {
      // Collector: old version first, then the correction lands mid-sync.
      mergeQueueEvents([oldV]);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // stagger
      mergeQueueEvents([correctedV]);
    } else {
      // Syncer: ACK exactly the old version once it appears.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      const deadline = Date.now() + 5000;
      for (;;) {
        const queued = readQueue().map(queueEventVersion);
        if (queued.includes(queueEventVersion(oldV))) {
          resolveQueueEvents({ accepted: [oldV], rejected: [] });
          break;
        }
        if (Date.now() > deadline) { console.error(`worker1: oldV never appeared at iter ${i}`); process.exit(3); }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
      }
    }
  }
  console.log(`worker${workerId} done`);
}
main();
