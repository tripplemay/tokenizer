import { Command } from "commander";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { configPath, configure, credentialsPath, devicePath, ensureConfig, queuePath, readConfig, readDevice, statePath } from "./config";
import { collectEvents, writeQueue } from "./collect";
import { clearQueue, readQueue, syncEvents } from "./sync";
import { diagnoseOpenCode } from "@/parsers/opencode";
import { enrollDevice } from "./enroll";
import { runAgent, runHeartbeat, runOnce } from "./agent";
import { installService, serviceStatus, uninstallService } from "./service";

const program = new Command();

program.name("tokenizer").description("Collect and analyze coding token usage").version("0.1.0");

program.command("init").description("Create ~/.tokenizer/config.json and device.json").option("--device-name <name>", "Human-readable device name").action((options: { deviceName?: string }) => {
  ensureConfig({ deviceName: options.deviceName });
  const device = readDevice();
  console.log(`Config ready: ${configPath}`);
  console.log(`Device ready: ${devicePath} (${device.name}, ${device.id})`);
});

program.command("configure").description("Update local tokenizer configuration").option("--server-url <url>", "Tokenizer server URL").option("--project-root <path>", "Project root directory").action((options: { serverUrl?: string; projectRoot?: string }) => {
  const config = configure({ serverUrl: options.serverUrl, projectRoot: options.projectRoot });
  console.log(`Config updated: ${configPath}`);
  console.log(`Server: ${config.serverUrl}`);
});

program.command("enroll").description("Enroll this device with a one-time enrollment token").requiredOption("--enroll-token <token>", "Enrollment token").option("--server-url <url>", "Tokenizer server URL").option("--device-name <name>", "Human-readable device name").option("--yes", "Use detected device name without prompting").action(async (options: { enrollToken: string; serverUrl?: string; deviceName?: string; yes?: boolean }) => {
  const { device } = await enrollDevice(options);
  console.log(`Enrolled device: ${device.name} (${device.id})`);
  console.log(`Credentials ready: ${credentialsPath}`);
});

program.command("collect").description("Collect local usage events into queue").action(() => {
  const config = readConfig();
  const { events, warnings } = collectEvents(config);
  writeQueue(events);
  console.log(`Collected ${events.length} events into ${queuePath}`);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
});

program.command("sync").description("Sync queued events to server").action(async () => {
  const config = readConfig();
  const events = readQueue();
  const result = await syncEvents(config, events);
  clearQueue();
  console.log(`Synced ${result.received} events: inserted=${result.inserted}, duplicates=${result.duplicates}`);
});

program.command("run").description("Collect and sync in one step").action(async () => {
  const result = await runOnce();
  console.log(`Synced ${result.received} events: inserted=${result.inserted}, duplicates=${result.duplicates}`);
});

program.command("heartbeat").description("Send one device heartbeat").action(async () => {
  const result = await runHeartbeat();
  console.log(`Heartbeat ok: ${result.deviceId} ${result.lastSeenAt}`);
});

program.command("agent").description("Run the tokenizer background agent in the foreground").option("--heartbeat-seconds <seconds>", "Heartbeat interval", "60").option("--sync-minutes <minutes>", "Collect/sync interval", "15").action(async (options: { heartbeatSeconds: string; syncMinutes: string }) => {
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
  console.log(`Config: ${existsSync(configPath) ? configPath : "missing"}`);
  console.log(`Device: ${existsSync(devicePath) ? `${devicePath} (${readDevice().name}, ${readDevice().id})` : "missing"}`);
  console.log(`Credentials: ${existsSync(credentialsPath) ? credentialsPath : "missing"}`);
  console.log(`Queue: ${existsSync(queuePath) ? `${queuePath} (${readQueue().length} events)` : "empty"}`);
  console.log(`State: ${existsSync(statePath) ? statePath : "missing"}`);
});

program.command("diagnose [source]").description("Diagnose parser source availability").action((source?: string) => {
  if (!source || source === "opencode") {
    const found = diagnoseOpenCode(homedir(), process.cwd());
    if (found.length === 0) console.log("No OpenCode log directories found.");
    else console.log(found.join("\n"));
  }
});

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
