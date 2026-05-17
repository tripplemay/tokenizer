import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { collectEvents, dedupeBySourceEventId, writeQueue } from "./collect";
import { clearQueue, readQueue, syncEvents, heartbeat } from "./sync";
import { readConfig, updateState } from "./config";

const logPath = join(homedir(), ".tokenizer", "logs", "agent.log");

function log(message: string) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

export async function runOnce() {
  const config = readConfig();
  const startedAt = new Date().toISOString();
  // Refresh the server-side lastSeenAt at the start of every cron-triggered
  // run so the dashboard reflects "device is alive" right after sync, not just
  // when an explicit `tokenizer agent` loop is running. Heartbeat failures are
  // non-fatal — sync will surface real connectivity errors separately.
  try {
    await heartbeat(config);
  } catch {
    /* ignore */
  }
  const collected = collectEvents(config);
  const queued = readQueue();
  const events = dedupeBySourceEventId([...queued, ...collected.events]);
  // Persist the deduped set up front so a sync failure (or process kill mid-sync)
  // doesn't lose the freshly collected events and so the queue cannot grow
  // unboundedly across repeated failures.
  writeQueue(events);
  try {
    const result = await syncEvents(config, events);
    clearQueue();
    updateState({
      lastRunAt: startedAt,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "success",
      lastError: null,
      lastCollectedEvents: collected.events.length,
      lastSentEvents: events.length,
      lastInserted: result.inserted,
      lastDuplicates: result.duplicates
    });
    log(`sync received=${result.received} inserted=${result.inserted} duplicates=${result.duplicates}`);
    for (const warning of collected.warnings) log(`warning ${warning}`);
    return result;
  } catch (error) {
    // Queue already holds the deduped events; nothing more to write.
    updateState({ lastRunAt: startedAt, lastSyncStatus: "failed", lastError: error instanceof Error ? error.message : String(error) });
    log(`sync failed ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function runHeartbeat() {
  const config = readConfig();
  try {
    const result = await heartbeat(config);
    updateState({ lastHeartbeatAt: new Date().toISOString(), lastHeartbeatStatus: "success" });
    return result;
  } catch (error) {
    updateState({ lastHeartbeatAt: new Date().toISOString(), lastHeartbeatStatus: "failed", lastError: error instanceof Error ? error.message : String(error) });
    log(`heartbeat failed ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function runAgent(options: { heartbeatSeconds: number; syncMinutes: number }) {
  let syncing = false;
  let stopped = false;
  updateState({ agent: { status: "running", pid: process.pid, startedAt: new Date().toISOString() } });
  log(`agent started pid=${process.pid}`);

  const sync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      await runOnce();
    } catch {
      // Errors are already written to state/log; keep the agent alive.
    } finally {
      syncing = false;
    }
  };

  const beat = async () => {
    try {
      await runHeartbeat();
    } catch {
      // Keep running after transient heartbeat failures.
    }
  };

  const shutdown = () => {
    stopped = true;
    updateState({ agent: { status: "stopped", pid: process.pid, stoppedAt: new Date().toISOString() } });
    log("agent stopped");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await beat();
  await sync();
  const heartbeatTimer = setInterval(() => void beat(), options.heartbeatSeconds * 1000);
  const syncTimer = setInterval(() => void sync(), options.syncMinutes * 60 * 1000);
  while (!stopped) await new Promise((resolve) => setTimeout(resolve, 60_000));
  clearInterval(heartbeatTimer);
  clearInterval(syncTimer);
}
