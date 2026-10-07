import { Command } from "commander";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { configPath, configure, credentialsPath, defaultConfig, devicePath, ensureConfig, queuePath, readConfig, readDevice, rejectedUsagePath, statePath, updateState } from "./config";
import { collectEvents, mergeQueueEvents } from "./collect";
import { readQueue, syncEvents } from "./sync";
import { diagnoseOpenCode } from "@/parsers/opencode";
import { diagnoseKimiCode } from "@/parsers/kimicode";
import { enrollDevice } from "./enroll";
import { runAgent, runHeartbeat, runOnce } from "./agent";
import { runHarnessCommand } from "./harness-command";
import { installService, serviceStatus, uninstallService } from "./service";
import { collectionScopeFingerprint, describePrivacyBacklog, effectivePrivacy } from "./privacy";
import { readCursor, writeCursor } from "./cursor";
import { readRejectedUsageEvents } from "./rejected-events";

const program = new Command();

program.name("tokenizer").description("Collect and analyze coding token usage").version("0.1.0");

program.command("init").description("Create ~/.tokenizer/config.json and device.json").option("--device-name <name>", "Human-readable device name").action((options: { deviceName?: string }) => {
  ensureConfig({ deviceName: options.deviceName });
  const device = readDevice();
  console.log(`Config ready: ${configPath}`);
  console.log(`Device ready: ${devicePath} (${device.name}, ${device.id})`);
});

program.command("configure").description("Update local tokenizer configuration")
  .option("--server-url <url>", "Tokenizer server URL")
  .option("--project-root <path>", "Project root directory (workspace inference, not a privacy allowlist)")
  .option("--privacy-mode <mode>", "sync, local-only, or paused")
  .option("--include-path <path...>", "Replace include paths for future incremental collection only")
  .option("--exclude-path <path...>", "Replace exclude paths for future incremental collection only")
  .option("--clear-include-paths", "Clear collection include paths")
  .option("--clear-exclude-paths", "Clear collection exclude paths")
  .action((options: { serverUrl?: string; projectRoot?: string; privacyMode?: "sync" | "local-only" | "paused"; includePath?: string[]; excludePath?: string[]; clearIncludePaths?: boolean; clearExcludePaths?: boolean }) => {
  const config = configure({
    serverUrl: options.serverUrl,
    projectRoot: options.projectRoot,
    privacyMode: options.privacyMode,
    includePaths: options.clearIncludePaths ? [] : options.includePath,
    excludePaths: options.clearExcludePaths ? [] : options.excludePath
  });
  console.log(`Config updated: ${configPath}`);
  console.log(`Server: ${config.serverUrl}`);
  const privacy = effectivePrivacy(config);
  console.log(`Privacy: ${privacy.mode}`);
  console.log(describePrivacyBacklog(privacy.mode, readQueue().length));
  console.log("Path-rule changes apply to future incremental collection only; queued events and parser cursors are not reset.");
});

program.command("preview").description("Preview local usage events without enrollment, queue writes, or network calls")
  .option("--limit <count>", "Number of minimized events to show", "5")
  .action((options: { limit: string }) => {
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new Error("Preview limit must be between 0 and 100");
    const config = existsSync(configPath) ? readConfig() : defaultConfig();
    const privacy = effectivePrivacy(config);
    const { events, warnings } = collectEvents(config);
    console.log(JSON.stringify({ mode: privacy.mode, includePaths: privacy.includePaths, excludePaths: privacy.excludePaths, count: events.length, sample: events.slice(0, limit), warnings }, null, 2));
  });

program.command("enroll").description("Enroll this device with a one-time enrollment token").requiredOption("--enroll-token <token>", "Enrollment token").option("--server-url <url>", "Tokenizer server URL").option("--device-name <name>", "Human-readable device name").option("--yes", "Use detected device name without prompting").action(async (options: { enrollToken: string; serverUrl?: string; deviceName?: string; yes?: boolean }) => {
  const { device } = await enrollDevice(options);
  console.log(`Enrolled device: ${device.name} (${device.id})`);
  console.log(`Credentials ready: ${credentialsPath}`);
});

program.command("harness")
  .description("Report harness orchestration state and relay signed gate decisions")
  .option("--list", "Only list discovered harness projects")
  .option("--modes", "Show local mode snapshots for discovered harness projects")
  .option("--status", "Read the latest local harness health snapshot without syncing")
  .option("--json", "Run one sync and print only its health snapshot as JSON")
  .action((options) => runHarnessCommand(options));

program.command("collect").description("Collect local usage events into queue").action(() => {
  const config = readConfig();
  const privacy = effectivePrivacy(config);
  if (privacy.mode === "paused") {
    console.log("Collection paused; queue and parser cursors are unchanged.");
    return;
  }
  const cursor = readCursor();
  const { events, warnings } = collectEvents(config, cursor);
  const merged = mergeQueueEvents(events);
  writeCursor(cursor);
  updateState({ lastCollectionScopeFingerprint: collectionScopeFingerprint(privacy) });
  console.log(`Collected ${events.length} events; queue holds ${merged.length} unique events at ${queuePath}`);
  console.log(describePrivacyBacklog(privacy.mode, merged.length));
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
});

program.command("sync").description("Sync queued events to server").action(async () => {
  const config = readConfig();
  const privacy = effectivePrivacy(config);
  if (privacy.mode !== "sync") throw new Error(`Usage sync disabled by privacy mode: ${privacy.mode}`);
  const events = readQueue();
  console.log(describePrivacyBacklog(privacy.mode, events.length));
  const result = await syncEvents(config, events);
  console.log(`Synced ${result.received} events: inserted=${result.inserted}, duplicates=${result.duplicates}, rejected=${result.rejected ?? 0}`);
});

program.command("run").description("Collect and sync in one step").action(async () => {
  const result = await runOnce();
  console.log(`Synced ${result.received} events: inserted=${result.inserted}, duplicates=${result.duplicates}, rejected=${result.rejected ?? 0}`);
});

program.command("heartbeat").description("Send one device heartbeat").action(async () => {
  const result = await runHeartbeat();
  console.log(`Heartbeat ok: ${result.deviceId} ${result.lastSeenAt}`);
});

program.command("agent").description("Run the tokenizer background agent in the foreground").allowExcessArguments(false).option("--heartbeat-seconds <seconds>", "Heartbeat interval", "60").option("--sync-minutes <minutes>", "Collect/sync interval", "15").action(async (options: { heartbeatSeconds: string; syncMinutes: string }) => {
  await runAgent({ heartbeatSeconds: Number(options.heartbeatSeconds), syncMinutes: Number(options.syncMinutes) });
});

program.command("install-service").description("Install tokenizer agent service").option("--heartbeat-seconds <seconds>", "Heartbeat interval", "60").option("--sync-minutes <minutes>", "Collect/sync interval", "15").action((options: { heartbeatSeconds: string; syncMinutes: string }) => {
  console.log(installService({ heartbeatSeconds: Number(options.heartbeatSeconds), syncMinutes: Number(options.syncMinutes) }));
});

program.command("uninstall-service").description("Uninstall tokenizer agent service").action(() => {
  console.log(uninstallService());
});

program.command("service-status").description("Show tokenizer service status").action(() => {
  console.log(serviceStatus());
});

program.command("status").description("Show local configuration and queue status").action(() => {
  const backlogCount = readQueue().length;
  console.log(`Config: ${existsSync(configPath) ? configPath : "missing"}`);
  console.log(`Device: ${existsSync(devicePath) ? `${devicePath} (${readDevice().name}, ${readDevice().id})` : "missing"}`);
  console.log(`Credentials: ${existsSync(credentialsPath) ? credentialsPath : "missing"}`);
  console.log(`Queue: ${existsSync(queuePath) ? `${queuePath} (${backlogCount} events)` : "empty"}`);
  if (existsSync(rejectedUsagePath)) {
    try {
      console.log(`Rejected usage: ${rejectedUsagePath} (${readRejectedUsageEvents().length} events; manual repair/replay required)`);
    } catch {
      console.log(`Rejected usage: ${rejectedUsagePath} (unreadable; active queue remains fail-closed)`);
    }
  } else {
    console.log("Rejected usage: empty");
  }
  console.log(`State: ${existsSync(statePath) ? statePath : "missing"}`);
  if (existsSync(configPath)) {
    const privacy = effectivePrivacy(readConfig());
    console.log(`Privacy: ${privacy.mode}`);
    console.log(describePrivacyBacklog(privacy.mode, backlogCount));
    console.log(`Collection scope: ${collectionScopeFingerprint(privacy)} (local label; does not reset cursors)`);
  }
});

program.command("diagnose [source]").description("Diagnose parser source availability").action((source?: string) => {
  if (!source || source === "opencode") {
    const found = diagnoseOpenCode(homedir(), process.cwd());
    if (found.length === 0) console.log("No OpenCode log directories found.");
    else console.log(found.join("\n"));
  }
  if (!source || source === "kimicode") {
    const found = diagnoseKimiCode(homedir());
    if (found.length === 0) console.log("No Kimi Code session directories found.");
    else console.log(found.join("\n"));
  }
});

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
