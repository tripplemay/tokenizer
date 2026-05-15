import { Command } from "commander";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { configPath, ensureConfig, queuePath, readConfig } from "./config";
import { collectEvents, writeQueue } from "./collect";
import { clearQueue, readQueue, syncEvents } from "./sync";
import { diagnoseOpenCode } from "@/parsers/opencode";

const program = new Command();

program.name("tokenizer").description("Collect and analyze coding token usage").version("0.1.0");

program.command("init").description("Create ~/.tokenizer/config.json").action(() => {
  ensureConfig();
  console.log(`Config ready: ${configPath}`);
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
  const config = readConfig();
  const collected = collectEvents(config);
  const queued = readQueue();
  const events = [...queued, ...collected.events];
  try {
    const result = await syncEvents(config, events);
    clearQueue();
    console.log(`Synced ${result.received} events: inserted=${result.inserted}, duplicates=${result.duplicates}`);
  } catch (error) {
    writeQueue(collected.events);
    throw error;
  }
  for (const warning of collected.warnings) console.warn(`Warning: ${warning}`);
});

program.command("status").description("Show local configuration and queue status").action(() => {
  console.log(`Config: ${existsSync(configPath) ? configPath : "missing"}`);
  console.log(`Queue: ${existsSync(queuePath) ? `${queuePath} (${readQueue().length} events)` : "empty"}`);
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
