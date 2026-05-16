import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { dirname, join } from "node:path";

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
  if (platform() === "darwin") return installLaunchd(options);
  if (!isWsl() && hasSystemdUser()) return installSystemd(options);
  if (hasSystemdUser()) return installSystemd(options);
  return installCron(options);
}

function installLaunchd(options: { heartbeatSeconds: number; syncMinutes: number }) {
  const plist = join(homedir(), "Library", "LaunchAgents", "cc.tokenizer.agent.plist");
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>cc.tokenizer.agent</string>
  <key>ProgramArguments</key><array><string>${binPath}</string><string>agent</string><string>--heartbeat-seconds</string><string>${options.heartbeatSeconds}</string><string>--sync-minutes</string><string>${options.syncMinutes}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict></plist>
`
  );
  execFileSync("launchctl", ["unload", plist], { stdio: "ignore" });
  execFileSync("launchctl", ["load", plist], { stdio: "inherit" });
  return `Installed launchd agent: ${plist}`;
}

function installSystemd(options: { heartbeatSeconds: number; syncMinutes: number }) {
  const dir = join(homedir(), ".config", "systemd", "user");
  const service = join(dir, "tokenizer-agent.service");
  mkdirSync(dir, { recursive: true });
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

[Install]
WantedBy=default.target
`
  );
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  execFileSync("systemctl", ["--user", "enable", "--now", "tokenizer-agent.service"], { stdio: "inherit" });
  return `Installed systemd user service: ${service}`;
}

function installCron(options: { syncMinutes: number }) {
  const line = `*/${Math.max(1, options.syncMinutes)} * * * * ${binPath} run >> ${logPath} 2>&1`;
  let current = "";
  try {
    current = execFileSync("crontab", ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    current = "";
  }
  const filtered = current.split(/\r?\n/).filter((row) => row && !row.includes("tokenizer run"));
  const tmp = join(homedir(), ".tokenizer", "crontab.tmp");
  writeFileSync(tmp, `${filtered.join("\n")}${filtered.length ? "\n" : ""}${line}\n`);
  execFileSync("crontab", [tmp], { stdio: "inherit" });
  return "Installed cron fallback for tokenizer run";
}

export function uninstallService() {
  const messages: string[] = [];
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
    const filtered = current.split(/\r?\n/).filter((row) => row && !row.includes("tokenizer run"));
    const tmp = join(homedir(), ".tokenizer", "crontab.tmp");
    writeFileSync(tmp, `${filtered.join("\n")}\n`);
    execFileSync("crontab", [tmp], { stdio: "ignore" });
    messages.push("Removed cron fallback");
  } catch {}
  return messages.join("\n") || "No tokenizer service found";
}

export function serviceStatus() {
  const lines: string[] = [];
  const plist = join(homedir(), "Library", "LaunchAgents", "cc.tokenizer.agent.plist");
  if (existsSync(plist)) lines.push(`launchd: ${plist}`);
  if (hasSystemdUser()) {
    try { lines.push(execFileSync("systemctl", ["--user", "is-active", "tokenizer-agent.service"], { encoding: "utf8" }).trim()); } catch { lines.push("systemd: inactive"); }
  }
  try { if (readFileSync(join(homedir(), ".tokenizer", "crontab.tmp"), "utf8")) lines.push("cron fallback configured"); } catch {}
  return lines.join("\n") || "No tokenizer service detected";
}
