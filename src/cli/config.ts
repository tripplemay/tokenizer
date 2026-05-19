import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname, homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { DeviceInput } from "@/shared/usage";

export type TokenizerConfig = {
  serverUrl: string;
  projectRoots: string[];
  sources: {
    claude: boolean;
    codex: boolean;
    opencode: boolean;
    aider: boolean;
  };
};

export type TokenizerCredentials = {
  deviceToken: string;
};

export const configPath = join(homedir(), ".tokenizer", "config.json");
export const devicePath = join(homedir(), ".tokenizer", "device.json");
export const credentialsPath = join(homedir(), ".tokenizer", "credentials.json");
export const queuePath = join(homedir(), ".tokenizer", "queue.jsonl");
export const statePath = join(homedir(), ".tokenizer", "state.json");

export function defaultConfig(): TokenizerConfig {
  return {
    serverUrl: "http://localhost:3000",
    projectRoots: [join(homedir(), "project")],
    sources: { claude: true, codex: true, opencode: true, aider: true }
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
  const stored = JSON.parse(readFileSync(configPath, "utf8")) as TokenizerConfig;
  // Backfill source flags so an existing install (whose config.json was
  // written before a new source was added) auto-enables it on next read,
  // instead of needing a manual `tokenizer configure` to flip the flag.
  const defaults = defaultConfig();
  stored.sources = { ...defaults.sources, ...stored.sources };
  return stored;
}

export function writeConfig(config: TokenizerConfig) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function configure(options: { serverUrl?: string; projectRoot?: string; sources?: Partial<TokenizerConfig["sources"]> }) {
  const current = existsSync(configPath) ? readConfig() : defaultConfig();
  const projectRoots = options.projectRoot ? [options.projectRoot] : current.projectRoots;
  const config = {
    ...current,
    serverUrl: options.serverUrl ?? current.serverUrl,
    projectRoots,
    sources: { ...current.sources, ...options.sources }
  };
  writeConfig(config);
  return config;
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

export function writeDevice(device: DeviceInput) {
  mkdirSync(dirname(devicePath), { recursive: true });
  writeFileSync(devicePath, `${JSON.stringify(device, null, 2)}\n`);
}

export function readCredentials(): TokenizerCredentials {
  if (!existsSync(credentialsPath)) throw new Error(`Missing credentials. Run: tokenizer enroll --enroll-token <token>`);
  return JSON.parse(readFileSync(credentialsPath, "utf8")) as TokenizerCredentials;
}

export function writeCredentials(credentials: TokenizerCredentials) {
  mkdirSync(dirname(credentialsPath), { recursive: true });
  writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`);
  chmodSync(credentialsPath, 0o600);
}

export type TokenizerState = {
  lastSyncStatus?: "success" | "failed";
  lastError?: string;
  lastQuotaRefreshAt?: string;
  lastQuotaRefreshStatus?: "success" | "failed";
  lastEventActivityAt?: string;
  quotaAuthErrors?: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }>;
  [key: string]: unknown;
};

export function readState(): TokenizerState {
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as TokenizerState;
  } catch {
    return {};
  }
}

export function updateState(patch: Record<string, unknown>) {
  const current = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>) : {};
  writeFileSync(statePath, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
}
