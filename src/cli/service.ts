import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installWindowsService, uninstallWindowsService, windowsServiceStatus } from "@/cli/service-windows";
import { buildCronInstall, buildCronUninstall } from "@/cli/service-cron";

// The repo root this agent is running out of (~/.tokenizer/app for a normal
// install). Task Scheduler needs absolute paths for both the entry script and
// the working directory.
function installRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

const binPath = join(homedir(), ".local", "bin", "tokenizer");
const logPath = join(homedir(), ".tokenizer", "logs", "agent.log");

function isWsl() {
  return release().toLowerCase().includes("microsoft") || existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}

function hasSystemdUser() {
  try {
    execFileSync("systemctl", ["--user", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function installService(options: { heartbeatSeconds: number; syncMinutes: number }) {
  mkdirSync(dirname(logPath), { recursive: true });
  // Checked first: on Windows every branch below fails — hasSystemdUser()
  // throws, and the cron fallback shells out to a `crontab` that does not exist.
  if (platform() === "win32") return installWindowsService(options, installRoot());
  if (platform() === "darwin") return installLaunchd(options);
  if (!isWsl() && hasSystemdUser()) return installSystemd(options);
  if (hasSystemdUser()) return installSystemd(options);
  return installCron(options);
}

function resolveLaunchdPath(): string {
  // launchd starts processes with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin),
  // which means /usr/bin/env can't find a Homebrew-installed `node`. We bake
  // the actual node parent dir into the plist's PATH so the bin/tokenizer
  // shebang resolves regardless of launchd's environment.
  const candidates = [
    "/opt/homebrew/bin",
    "/opt/homebrew/opt/node@22/bin",
    "/opt/homebrew/opt/node/bin",
    "/usr/local/bin",
    "/usr/local/opt/node@22/bin",
    "/usr/local/opt/node/bin",
    join(homedir(), ".local", "bin")
  ].filter((dir) => existsSync(dir));
  let nodeDir: string | null = null;
  try {
    const which = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
    if (which) nodeDir = dirname(which);
  } catch {
    /* fall through to candidates */
  }
  const dirs = new Set<string>([...(nodeDir ? [nodeDir] : []), ...candidates, "/usr/bin", "/bin"]);
  return Array.from(dirs).join(":");
}

// HTTP/HTTPS proxy env vars from the user's shell get propagated into the
// launchd/systemd job's environment so Node's fetch (Node 22+ undici
// EnvHttpProxyAgent) routes outbound traffic through e.g. Clash on macOS or
// a corporate HTTPS_PROXY on Linux. Without this, launchd starts the agent
// with a minimal env, fetch tries to connect directly, and DNS-hijacked fake
// IPs (198.18.0.0/15 etc.) make every heartbeat fail with "fetch failed".
const PROXY_ENV_KEYS = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "no_proxy", "all_proxy"] as const;
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function collectProxyEnv(): Array<[string, string]> {
  const seen = new Set<string>();
  const result: Array<[string, string]> = [];
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key];
    if (!value) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push([key, value]);
  }
  return result;
}

function installLaunchd(options: { heartbeatSeconds: number; syncMinutes: number }) {
  const plist = join(homedir(), "Library", "LaunchAgents", "cc.tokenizer.agent.plist");
  mkdirSync(dirname(plist), { recursive: true });
  const path = resolveLaunchdPath();
  const proxyEntries = collectProxyEnv();
  const envLines = [
    `<key>PATH</key><string>${escapeXml(path)}</string>`,
    `<key>HOME</key><string>${escapeXml(homedir())}</string>`,
    ...proxyEntries.map(([k, v]) => `<key>${k}</key><string>${escapeXml(v)}</string>`)
  ].join("\n    ");
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>cc.tokenizer.agent</string>
  <key>ProgramArguments</key><array><string>${binPath}</string><string>agent</string><string>--heartbeat-seconds</string><string>${options.heartbeatSeconds}</string><string>--sync-minutes</string><string>${options.syncMinutes}</string></array>
  <key>EnvironmentVariables</key><dict>
    ${envLines}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict></plist>
`
  );
  execFileSync("launchctl", ["unload", plist], { stdio: "ignore" });
  execFileSync("launchctl", ["load", plist], { stdio: "inherit" });
  const proxyLine = proxyEntries.length ? `\nproxy env: ${proxyEntries.map(([k]) => k).join(", ")}` : "";
  return `Installed launchd agent: ${plist}\nPATH: ${path}${proxyLine}`;
}

function installSystemd(options: { heartbeatSeconds: number; syncMinutes: number }) {
  const dir = join(homedir(), ".config", "systemd", "user");
  const service = join(dir, "tokenizer-agent.service");
  mkdirSync(dir, { recursive: true });
  const proxyEntries = collectProxyEnv();
  const envLines = proxyEntries
    .map(([k, v]) => `Environment="${k}=${v.replace(/"/g, '\\"')}"`)
    .join("\n");
  writeFileSync(
    service,
    `[Unit]
Description=Tokenizer agent

[Service]
ExecStart=${binPath} agent --heartbeat-seconds ${options.heartbeatSeconds} --sync-minutes ${options.syncMinutes}
Restart=always
RestartSec=10
StandardOutput=append:${logPath}
StandardError=append:${logPath}
${envLines}

[Install]
WantedBy=default.target
`
  );
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  execFileSync("systemctl", ["--user", "enable", "--now", "tokenizer-agent.service"], { stdio: "inherit" });
  const proxyLine = proxyEntries.length ? `\nproxy env: ${proxyEntries.map(([k]) => k).join(", ")}` : "";
  return `Installed systemd user service: ${service}${proxyLine}`;
}

function installCron(options: { syncMinutes: number }) {
  let current = "";
  try {
    current = execFileSync("crontab", ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    current = "";
  }
  const tmp = join(homedir(), ".tokenizer", "crontab.tmp");
  writeFileSync(tmp, buildCronInstall(current, { binPath, logPath, syncMinutes: options.syncMinutes }));
  execFileSync("crontab", [tmp], { stdio: "inherit" });
  return "Installed cron fallback for tokenizer run + harness";
}

export function uninstallService() {
  const messages: string[] = [];
  if (platform() === "win32") {
    return uninstallWindowsService() ?? "No tokenizer service found";
  }
  const plist = join(homedir(), "Library", "LaunchAgents", "cc.tokenizer.agent.plist");
  if (existsSync(plist)) {
    try { execFileSync("launchctl", ["unload", plist], { stdio: "ignore" }); } catch {}
    rmSync(plist);
    messages.push("Removed launchd agent");
  }
  if (hasSystemdUser()) {
    try { execFileSync("systemctl", ["--user", "disable", "--now", "tokenizer-agent.service"], { stdio: "ignore" }); messages.push("Removed systemd agent"); } catch {}
  }
  try {
    const current = execFileSync("crontab", ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const tmp = join(homedir(), ".tokenizer", "crontab.tmp");
    writeFileSync(tmp, buildCronUninstall(current, binPath));
    execFileSync("crontab", [tmp], { stdio: "ignore" });
    messages.push("Removed cron fallback");
  } catch {}
  return messages.join("\n") || "No tokenizer service found";
}

export function serviceStatus() {
  const lines: string[] = [];
  if (platform() === "win32") {
    return windowsServiceStatus() ?? "No tokenizer service detected";
  }
  const plist = join(homedir(), "Library", "LaunchAgents", "cc.tokenizer.agent.plist");
  if (existsSync(plist)) lines.push(`launchd: ${plist}`);
  if (hasSystemdUser()) {
    try { lines.push(execFileSync("systemctl", ["--user", "is-active", "tokenizer-agent.service"], { encoding: "utf8" }).trim()); } catch { lines.push("systemd: inactive"); }
  }
  try { if (readFileSync(join(homedir(), ".tokenizer", "crontab.tmp"), "utf8")) lines.push("cron fallback configured"); } catch {}
  return lines.join("\n") || "No tokenizer service detected";
}
