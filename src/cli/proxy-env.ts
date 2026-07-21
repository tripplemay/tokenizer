// Persisted proxy configuration, for the one backend that cannot carry
// environment variables.
//
// The launchd plist and the systemd unit both embed HTTPS_PROXY/HTTP_PROXY
// captured from the installing shell. Task Scheduler has no equivalent — a
// task definition cannot set environment variables at all. Without this, a
// Windows user behind a proxy installs successfully and then every heartbeat
// fails with "fetch failed", because the task inherits a session environment
// that never sourced their shell profile.
//
// So on install we snapshot the proxy vars to disk, and the agent falls back
// to that snapshot when the variables are absent from its own environment.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "@/cli/atomic-file";

export const proxyEnvPath = join(homedir(), ".tokenizer", "proxy.json");

export const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "all_proxy"
] as const;

export function captureProxyEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key];
    if (value) captured[key] = value;
  }
  return captured;
}

export function saveProxyEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const captured = captureProxyEnv(env);
  writeFileAtomic(proxyEnvPath, `${JSON.stringify(captured, null, 2)}\n`);
  return captured;
}

export function loadProxyEnv(path: string = proxyEnvPath): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Proxy URL for outbound requests: the live environment always wins, so a
 * user who changes their proxy in-shell is never overridden by a stale
 * snapshot from install time.
 */
export function resolveProxyUrl(env: Record<string, string | undefined> = process.env, path: string = proxyEnvPath): string | null {
  const ordered = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
  for (const key of ordered) {
    if (env[key]) return env[key] as string;
  }
  const saved = loadProxyEnv(path);
  for (const key of ordered) {
    if (saved[key]) return saved[key];
  }
  return null;
}
