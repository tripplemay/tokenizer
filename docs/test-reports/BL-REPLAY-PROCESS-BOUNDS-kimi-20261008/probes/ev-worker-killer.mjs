// Kimi F005: NODE_OPTIONS preload that kills the bounded-subprocess WORKER
// 300 ms in — AFTER it spawned and published the owned child PID. Exercises the
// parent's cleanupAfterWorkerFailure path, which Generator's controls never
// reach (their worker dies before spawn).
if (process.argv[1]?.endsWith("bounded-subprocess-worker.mjs")) {
  process.stderr.write("EV-RAW-WORKER-CANARY-KIMI\n");
  setTimeout(() => process.exit(71), 300);
}
