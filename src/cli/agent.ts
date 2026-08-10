import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { collectEvents, dedupeBySourceEventId, writeQueue } from "./collect";
import { clearQueue, readQueue, syncEvents, heartbeat } from "./sync";
import { readConfig, readState, updateState } from "./config";
import { readCursor, writeCursor } from "./cursor";
import { runQuotaRefresh } from "@/quota/run";
import { runHarnessSync, type HarnessSyncResult } from "./harness";
import { HARNESS_BASE_MS, initialHarnessBackoff, nextHarnessBackoff } from "./harness-backoff";
import { acquireAgentLock } from "./agent-lock";

const logPath = join(homedir(), ".tokenizer", "logs", "agent.log");

function log(message: string) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

export function formatHarnessLogLines(h: HarnessSyncResult): string[] {
  const lines = [
    `harness status=${h.snapshot.status} reported=${h.reported} failed=${h.failed} relayed=${h.applied} mode_intents=${h.stagedIntents} issues=${h.issues.length}`
  ];
  if (h.issueDetailsChanged) {
    for (const issue of h.issues) {
      lines.push(
        `harness issue operation=${issue.operation} project=${issue.project ?? "-"} code=${issue.code} retryable=${issue.retryable}`
      );
    }
  }
  if (h.recovered) lines.push("harness issues recovered");
  return lines;
}

function logHarness(h: HarnessSyncResult) {
  for (const line of formatHarnessLogLines(h)) log(line);
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
    // harness 编排状态上报 + 闸门决策中继。与 quota 同为非致命：这台机器没有 harness
    // 项目、或服务端还没上这个功能时，不该拖垮用量同步这条主链路。
    try {
      logHarness(await runHarnessSync(config));
    } catch (err) {
      log(`harness sync failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
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
  const agentLock = acquireAgentLock();
  let syncing = false;
  let stopped = false;
  let shutdownStarted = false;

  const shutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    stopped = true;
    try {
      updateState({ agent: { status: "stopped", pid: process.pid, stoppedAt: new Date().toISOString() } });
      log("agent stopped");
    } finally {
      // process.exit bypasses async/finally cleanup, so release before using
      // it. A hard kill still leaves a PID record that the next start safely
      // recognizes as stale.
      agentLock.release();
      process.exit(0);
    }
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

  try {
    const config = readConfig();
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
    let lastHarnessAt = 0;
    let harnessInFlight = false;
    // 闸门周转的体感上限：人在网页上批准后，最多等这么久机器才会拿到。清洁轮
    // 恒 60s；出问题后错误驱动退避（封顶 600s + 抖动），故障期不再每分钟重撞。
    let harnessBackoff = initialHarnessBackoff;
    let harnessDelayMs = HARNESS_BASE_MS;
    const settleHarnessRound = (hadIssues: boolean) => {
      const next = nextHarnessBackoff(harnessBackoff, hadIssues);
      harnessBackoff = next.state;
      harnessDelayMs = next.delayMs;
    };

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
      // 单飞：一次 harness 同步要遍历多个仓库并可能写盘 + commit，慢于 tick 时不叠加
      if (!harnessInFlight && now - lastHarnessAt >= harnessDelayMs) {
        lastHarnessAt = now;
        harnessInFlight = true;
        void runHarnessSync(config)
          .then((result) => {
            logHarness(result);
            settleHarnessRound(result.issues.length > 0);
          })
          .catch((err) => {
            log(`harness sync failed: ${err instanceof Error ? err.message : String(err)}`);
            settleHarnessRound(true);
          })
          .finally(() => {
            harnessInFlight = false;
          });
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
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    process.off("SIGBREAK", shutdown);
    process.off("SIGHUP", shutdown);
    agentLock.release();
  }
}
