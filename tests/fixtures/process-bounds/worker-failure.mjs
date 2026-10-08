if (process.argv[1]?.endsWith("bounded-subprocess-worker.mjs")) {
  process.stderr.write("RAW-WORKER-STDERR-CANARY\n");
  process.exit(71);
}
