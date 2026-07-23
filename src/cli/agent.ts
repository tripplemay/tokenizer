import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { collectEvents, dedupeBySourceEventId, writeQueue } from "./collect";
import { clearQueue, readQueue, syncEvents, heartbeat } from "./sync";
import { readConfig, readState, updateState } from "./config";
import { readCursor, writeCursor } from "./cursor";
import { runQuotaRefresh } from "@/quota/run";

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
  // Read cursor and pass to parsers. Parsers mutate the cursor in-place to
  // record per-file fingerprints and the OpenCode time_created high-water
  // mark. We only persist the mutated cursor after a successful sync below,
  // so a sync failure cleanly leaves us re-parsing the same files next run
  // (server-side createMany skipDuplicates handles the overlap).
  const cursor = readCursor();
  const collected = collectEvents(config, cursor);
  const queued = readQueue();
  const events = dedupeBySourceEventId([...queued, ...collected.events]);
  // Persist the deduped set up front so a sync failure (or process kill mid-sync)
  // doesn't lose the freshly collected events and so the queue cannot grow
  // unboundedly across repeated failures.
  writeQueue(events);
  try {
    const result = await syncEvents(config, events);
    clearQueue();
    writeCursor(cursor);
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
    log(`sync received=${result.received} inserted=${result.inserted} updated=${(result as { updated?: number }).updated ?? 0} duplicates=${result.duplicates}`);
    for (const warning of collected.warnings) log(`warning ${warning}`);
    // Refresh lastEventActivityAt so the agent's active-vs-idle scheduler knows
    // the user is still coding. Active threshold is 1h of zero events.
    if (collected.events.length > 0) {
      updateState({ lastEventActivityAt: new Date().toISOString() });
    }
    // Cron-mode safety net — call runQuotaRefresh at the end of runOnce so
    // users running `tokenizer run` on a cron get the same quota freshness
    // as daemon-mode users at sync cadence. Single-flighted, non-fatal.
    try {
      await runQuotaRefresh(config);
    } catch (err) {
      log(`quota refresh failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
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
    // Clear lastError on success so a transient heartbeat failure (e.g. a
    // 502 during a server deploy) doesn't stay stuck in state.json and keep
    // surfacing on the dashboard's diagnostics card forever.
    updateState({ lastHeartbeatAt: new Date().toISOString(), lastHeartbeatStatus: "success", lastError: null });
    return result;
  } catch (error) {
    updateState({ lastHeartbeatAt: new Date().toISOString(), lastHeartbeatStatus: "failed", lastError: error instanceof Error ? error.message : String(error) });
    log(`heartbeat failed ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function runAgent(options: { heartbeatSeconds: number; syncMinutes: number }) {
  const config = readConfig();
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
  // Windows never delivers SIGTERM — Node emits SIGBREAK for Ctrl+Break and
  // SIGHUP for a closed console window (POSIX raises SIGHUP on terminal
  // hangup too). Without these the agent skips its "stopped" state write.
  // Device status is derived from lastSeenAt age, so this is tidiness rather
  // than correctness, but leaving a stale "running" record around is
  // needlessly confusing when debugging.
  process.on("SIGBREAK", shutdown);
  process.on("SIGHUP", shutdown);

  // Tick-based scheduler instead of setInterval. setInterval timers freeze
  // while the host is asleep (laptop lid closed, macOS suspended) and on
  // wake their next callback may not fire for another full interval. The
  // 5-second tick polls the wall clock and beats/syncs whenever the
  // appropriate interval has elapsed, so a wake-from-sleep is reconciled
  // within ~5s instead of up to a full heartbeatSeconds.
  const TICK_MS = 5000;
  const QUOTA_ACTIVE_MS = 60_000;
  const QUOTA_IDLE_MS = 300_000;
  const ACTIVITY_WINDOW_MS = 60 * 60 * 1000;
  let lastBeatAt = 0;
  let lastSyncAt = 0;

  await beat();
  lastBeatAt = Date.now();
  await sync();
  lastSyncAt = Date.now();

  const tick = () => {
    if (stopped) return;
    const now = Date.now();
    if (now - lastBeatAt >= options.heartbeatSeconds * 1000) {
      lastBeatAt = now;
      void beat();
    }
    if (now - lastSyncAt >= options.syncMinutes * 60 * 1000) {
      lastSyncAt = now;
      void sync();
    }
    const state = readState();
    const lastActivityAt = state.lastEventActivityAt ? new Date(state.lastEventActivityAt).getTime() : 0;
    const isActive = lastActivityAt > 0 && (now - lastActivityAt) < ACTIVITY_WINDOW_MS;
    const quotaThreshold = isActive ? QUOTA_ACTIVE_MS : QUOTA_IDLE_MS;
    const lastQuotaAt = state.lastQuotaRefreshAt ? new Date(state.lastQuotaRefreshAt).getTime() : 0;
    if (now - lastQuotaAt >= quotaThreshold) {
      void runQuotaRefresh(config).catch((err) => {
        log(`quota refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    setTimeout(tick, TICK_MS);
  };
  setTimeout(tick, TICK_MS);

  while (!stopped) await new Promise((resolve) => setTimeout(resolve, 60_000));
}
