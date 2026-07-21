// Windows background service, via Task Scheduler.
//
// Why a scheduled task and not a real Windows Service: the collectors read
// %USERPROFILE%\.claude, \.codex, \.kimi-code. A service runs as SYSTEM, whose
// profile is C:\Windows\System32\config\systemprofile — every source would
// come up empty. Task Scheduler runs in the user's own session, needs no
// elevation, and its ONLOGON trigger plus RestartOnFailure reproduces the
// KeepAlive semantics launchd and systemd give us elsewhere.

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { saveProxyEnv } from "@/cli/proxy-env";

export const TASK_NAME = "Tokenizer Agent";

export type TaskOptions = {
  nodePath: string;
  scriptPath: string;
  workingDir: string;
  heartbeatSeconds: number;
  syncMinutes: number;
  userId?: string | null;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function currentTaskUser(): string | null {
  const user = process.env.USERNAME;
  if (!user) return null;
  const domain = process.env.USERDOMAIN;
  return domain ? `${domain}\\${user}` : user;
}

/**
 * Build the task definition.
 *
 * Four Task Scheduler defaults are actively hostile to a long-lived process
 * and are each overridden below. Left alone, the agent looks installed and
 * then quietly dies:
 *   ExecutionTimeLimit        default PT72H  — killed after three days
 *   StopIfGoingOnBatteries    default true   — killed the moment a laptop unplugs
 *   DisallowStartIfOnBatteries default true  — never starts on battery at all
 *   StopOnIdleEnd             default true   — killed when the machine leaves idle
 *
 * Element order inside <Settings> is schema-significant: this is the sequence
 * Task Scheduler itself emits when exporting a task.
 */
export function buildTaskXml(options: TaskOptions): string {
  const args = [
    "--import",
    "tsx",
    `"${options.scriptPath}"`,
    "agent",
    "--heartbeat-seconds",
    String(options.heartbeatSeconds),
    "--sync-minutes",
    String(options.syncMinutes)
  ].join(" ");

  // `??` would be wrong here: an explicit null means "register without a
  // UserId", and `??` cannot distinguish that from the property being absent.
  const userId = options.userId !== undefined ? options.userId : currentTaskUser();
  const principalUser = userId ? `\n      <UserId>${escapeXml(userId)}</UserId>` : "";
  const triggerUser = userId ? `\n      <UserId>${escapeXml(userId)}</UserId>` : "";

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Tokenizer usage collection agent</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>${triggerUser}
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">${principalUser}
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(options.nodePath)}</Command>
      <Arguments>${escapeXml(args)}</Arguments>
      <WorkingDirectory>${escapeXml(options.workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/**
 * schtasks rejects a UTF-8 XML file with a bare "task XML is malformed" —
 * it expects UTF-16. The BOM is required for it to detect the encoding.
 */
export function encodeTaskXml(xml: string): Buffer {
  return Buffer.from(`﻿${xml}`, "utf16le");
}

export function registerTask(xml: string, taskName = TASK_NAME): void {
  const file = join(tmpdir(), `tokenizer-task-${process.pid}.xml`);
  writeFileSync(file, encodeTaskXml(xml));
  try {
    execFileSync("schtasks", ["/Create", "/TN", taskName, "/XML", file, "/F"], { stdio: "inherit" });
  } finally {
    rmSync(file, { force: true });
  }
}

export function installWindowsService(options: { heartbeatSeconds: number; syncMinutes: number }, installRoot: string): string {
  const xml = buildTaskXml({
    // process.execPath is the absolute node.exe currently running us, which
    // sidesteps Task Scheduler's PATH being different from the user's shell.
    nodePath: process.execPath,
    scriptPath: join(installRoot, "src", "cli", "index.ts"),
    // tsx is resolved relative to the working directory, same reason
    // bin/tokenizer sets cwd.
    workingDir: installRoot,
    heartbeatSeconds: options.heartbeatSeconds,
    syncMinutes: options.syncMinutes
  });
  registerTask(xml);
  // A task definition cannot carry environment variables, so the proxy
  // settings from the installing shell are snapshotted to disk instead.
  const proxy = saveProxyEnv();
  const proxyKeys = Object.keys(proxy);
  const logPath = join(homedir(), ".tokenizer", "logs", "agent.log");
  const proxyLine = proxyKeys.length ? `\nproxy env saved: ${proxyKeys.join(", ")}` : "";
  return `Installed scheduled task: ${TASK_NAME}\nRuns at logon, restarts on failure.\nLog: ${logPath}${proxyLine}`;
}

export function uninstallWindowsService(): string | null {
  try {
    execFileSync("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"], { stdio: "ignore" });
    return `Removed scheduled task: ${TASK_NAME}`;
  } catch {
    return null;
  }
}

export function windowsServiceStatus(): string | null {
  try {
    const output = execFileSync("schtasks", ["/Query", "/TN", TASK_NAME, "/FO", "LIST"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const status = /^\s*Status:\s*(.+)$/m.exec(output)?.[1]?.trim();
    return `schtasks: ${TASK_NAME}${status ? ` (${status})` : ""}`;
  } catch {
    return null;
  }
}
