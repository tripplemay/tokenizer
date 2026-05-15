import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname, homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { DeviceInput } from "@/shared/usage";

export type TokenizerConfig = {
  serverUrl: string;
  apiKey: string;
  projectRoots: string[];
  sources: {
    claude: boolean;
    codex: boolean;
    opencode: boolean;
  };
};

export const configPath = join(homedir(), ".tokenizer", "config.json");
export const devicePath = join(homedir(), ".tokenizer", "device.json");
export const queuePath = join(homedir(), ".tokenizer", "queue.jsonl");

export function defaultConfig(): TokenizerConfig {
  return {
    serverUrl: "http://localhost:3000",
    apiKey: "change-me",
    projectRoots: [join(homedir(), "project")],
    sources: { claude: true, codex: true, opencode: true }
  };
}

export function ensureConfig(options?: { deviceName?: string }): TokenizerConfig {
  const hadConfig = existsSync(configPath);
  if (!hadConfig) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  }
  ensureDevice({ ...options, preferLegacyId: hadConfig && !existsSync(devicePath) });
  return readConfig();
}

export function readConfig(): TokenizerConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Missing config. Run: tokenizer init`);
  }
  return JSON.parse(readFileSync(configPath, "utf8")) as TokenizerConfig;
}

export function ensureDevice(options?: { deviceName?: string; preferLegacyId?: boolean }): DeviceInput {
  if (!existsSync(devicePath)) {
    mkdirSync(dirname(devicePath), { recursive: true });
    const name = options?.deviceName || hostname();
    const device: DeviceInput = {
      id: options?.preferLegacyId ? "dev_local_legacy" : `dev_${randomUUID().replace(/-/g, "")}`,
      name,
      hostname: hostname(),
      platform: platform(),
      metadata: { createdAt: new Date().toISOString() }
    };
    writeFileSync(devicePath, `${JSON.stringify(device, null, 2)}\n`);
    return device;
  }

  const device = readDevice();
  if (options?.deviceName && options.deviceName !== device.name) {
    const updated = { ...device, name: options.deviceName };
    writeFileSync(devicePath, `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
  }
  return device;
}

export function readDevice(): DeviceInput {
  if (!existsSync(devicePath)) return ensureDevice();
  return JSON.parse(readFileSync(devicePath, "utf8")) as DeviceInput;
}
