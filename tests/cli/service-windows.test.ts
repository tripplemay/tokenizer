import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentVbs, buildTaskXml, encodeUtf16Le, registerTask, TASK_NAME } from "@/cli/service-windows";

const vbsOptions = {
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  scriptPath: "C:\\Users\\me\\.tokenizer\\app\\src\\cli\\index.ts",
  heartbeatSeconds: 60,
  syncMinutes: 15
};

const options = {
  wscriptPath: "C:\\Windows\\System32\\wscript.exe",
  vbsPath: "C:\\Users\\me\\.tokenizer\\bin\\tokenizer-agent.vbs",
  workingDir: "C:\\Users\\me\\.tokenizer\\app",
  userId: "MACHINE\\me"
};

describe("buildAgentVbs", () => {
  // The launcher exists to solve exactly one problem: Task Scheduler shows a
  // console window for console programs in the user's session, and a visible
  // window invites the user to close it — which killed the agent in the field.
  it("starts node with window style 0 so no console window ever appears", () => {
    expect(buildAgentVbs(vbsOptions)).toContain(", 0, True)");
  });

  it("waits for the agent and propagates its exit code to Task Scheduler", () => {
    // Without the wait, wscript exits immediately: the task reads "completed",
    // IgnoreNew stops deduplicating, and RestartOnFailure observes nothing.
    const vbs = buildAgentVbs(vbsOptions);
    expect(vbs).toContain("shell.Run(");
    expect(vbs).toContain("WScript.Quit exitCode");
  });

  it("doubles embedded quotes per VBScript string literal rules", () => {
    expect(buildAgentVbs(vbsOptions)).toContain('""C:\\Program Files\\nodejs\\node.exe"" --import tsx');
  });

  it("passes the agent cadence through", () => {
    expect(buildAgentVbs(vbsOptions)).toContain("agent --heartbeat-seconds 60 --sync-minutes 15");
  });

  it("uses CRLF line endings, as a Windows script file should", () => {
    const lines = buildAgentVbs(vbsOptions).split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line).not.toContain("\n");
  });
});

describe("buildTaskXml", () => {
  // Each of these four is a Task Scheduler default that silently kills a
  // long-lived process. They are the difference between "installed" and
  // "actually still running next week".
  it("lifts the 72-hour execution time limit", () => {
    expect(buildTaskXml(options)).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
  });

  it("keeps running when the machine goes on battery", () => {
    expect(buildTaskXml(options)).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
  });

  it("starts even when already on battery", () => {
    expect(buildTaskXml(options)).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
  });

  it("keeps running when the machine stops being idle", () => {
    expect(buildTaskXml(options)).toContain("<StopOnIdleEnd>false</StopOnIdleEnd>");
  });

  it("restarts on failure, which covers the crash half of launchd KeepAlive", () => {
    const xml = buildTaskXml(options);
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<Interval>PT1M</Interval>");
  });

  it("triggers at logon", () => {
    expect(buildTaskXml(options)).toContain("<LogonTrigger>");
  });

  it("revives a cleanly-exited agent via a repeating trigger, covering the other half", () => {
    // RestartOnFailure only reacts to failure exits. A Ctrl+C (exit 0) or a
    // schtasks /End left the agent dead until the next logon — unbounded on an
    // always-on machine. The repeating trigger bounds that to its interval;
    // IgnoreNew makes each fire a no-op while the agent is alive.
    const xml = buildTaskXml(options);
    expect(xml).toContain("<TimeTrigger>");
    expect(xml).toContain("<Interval>PT15M</Interval>");
    expect(xml).toContain("<StopAtDurationEnd>false</StopAtDurationEnd>");
  });

  it("refuses to stack duplicate instances", () => {
    expect(buildTaskXml(options)).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
  });

  it("runs unelevated in the user's session so %USERPROFILE% resolves correctly", () => {
    const xml = buildTaskXml(options);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  });

  it("launches through wscript so the agent runs with no console window", () => {
    const xml = buildTaskXml(options);
    expect(xml).toContain("<Command>C:\\Windows\\System32\\wscript.exe</Command>");
    expect(xml).toContain("//B //Nologo &quot;C:\\Users\\me\\.tokenizer\\bin\\tokenizer-agent.vbs&quot;");
  });

  it("sets the working directory so tsx resolves for the launched agent", () => {
    expect(buildTaskXml(options)).toContain("<WorkingDirectory>C:\\Users\\me\\.tokenizer\\app</WorkingDirectory>");
  });

  it("escapes XML metacharacters in paths", () => {
    const xml = buildTaskXml({ ...options, workingDir: "C:\\a & b\\<c>" });
    expect(xml).toContain("<WorkingDirectory>C:\\a &amp; b\\&lt;c&gt;</WorkingDirectory>");
  });

  it("omits UserId entirely when explicitly given null", () => {
    const xml = buildTaskXml({ ...options, userId: null });
    expect(xml).not.toContain("<UserId>");
  });

  it("distinguishes an absent userId from an explicit null", () => {
    // `??` cannot tell these apart, so an explicit null silently fell back to
    // the ambient USERNAME — invisible on a machine where it happens to be unset.
    // Both variables are pinned: leaving USERDOMAIN ambient makes the
    // expected value differ between a domain-joined machine and a local one.
    const originalUser = process.env.USERNAME;
    const originalDomain = process.env.USERDOMAIN;
    process.env.USERNAME = "someone";
    process.env.USERDOMAIN = "MACHINE";
    try {
      const { userId, ...withoutUserId } = options;
      expect(buildTaskXml(withoutUserId)).toContain("<UserId>MACHINE\\someone</UserId>");
      expect(buildTaskXml({ ...options, userId: null })).not.toContain("<UserId>");
    } finally {
      if (originalUser === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = originalUser;
      if (originalDomain === undefined) delete process.env.USERDOMAIN;
      else process.env.USERDOMAIN = originalDomain;
    }
  });
});

describe("encodeUtf16Le", () => {
  it("emits UTF-16 with a BOM", () => {
    // schtasks rejects UTF-8 task XML with an unhelpful "task XML is
    // malformed"; WSH needs the BOM to read a .vbs as Unicode. Same encoding
    // serves both.
    const buffer = encodeUtf16Le("<Task/>");
    expect(buffer[0]).toBe(0xff);
    expect(buffer[1]).toBe(0xfe);
    expect(buffer.toString("utf16le")).toBe("﻿<Task/>");
  });
});

// The XML schema is order-sensitive and cannot be validated by reading it.
// This runs for real on the windows-latest CI job; everywhere else it skips.
const describeWindows = process.platform === "win32" ? describe : describe.skip;

describeWindows("schtasks registration (real)", () => {
  const testTaskName = "Tokenizer Agent Test";

  it("is accepted by schtasks and can be queried and deleted", () => {
    const xml = buildTaskXml({
      ...options,
      wscriptPath: `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\wscript.exe`,
      userId: null
    });
    try {
      registerTask(xml, testTaskName);
      const query = execFileSync("schtasks", ["/Query", "/TN", testTaskName, "/FO", "LIST"], { encoding: "utf8" });
      expect(query).toContain(testTaskName);
    } finally {
      try {
        execFileSync("schtasks", ["/Delete", "/TN", testTaskName, "/F"], { stdio: "ignore" });
      } catch {
        /* nothing to clean up if registration never succeeded */
      }
    }
  });

  it("uses a task name that does not collide with the real one", () => {
    expect(testTaskName).not.toBe(TASK_NAME);
  });
});

// String assertions on the generated VBS cannot catch a quoting or encoding
// mistake that WSH rejects at parse time — the exact class of bug that only
// surfaces on a user's machine. So execute the real thing: same generator,
// same UTF-16 encoding, run by the real script host. cscript instead of
// wscript only because a console host's exit code is directly observable;
// the parser and Run() semantics are the same engine.
describeWindows("vbs launcher (real)", () => {
  const withFixture = (exitCode: number): number | undefined => {
    const dir = mkdtempSync(join(tmpdir(), "tokenizer-vbs-"));
    try {
      // The launcher hardcodes `--import tsx <script> agent ...`, so the
      // fixture stands in for src/cli/index.ts: it ignores its args and exits
      // with a known code. cwd stays at the repo root so tsx resolves, same
      // as the scheduled task's WorkingDirectory.
      const fixture = join(dir, "fixture.mjs");
      writeFileSync(fixture, `process.exit(${exitCode});\n`);
      const vbs = buildAgentVbs({
        nodePath: process.execPath,
        scriptPath: fixture,
        heartbeatSeconds: 60,
        syncMinutes: 15
      });
      const vbsFile = join(dir, "tokenizer-agent.vbs");
      writeFileSync(vbsFile, encodeUtf16Le(vbs));
      try {
        execFileSync("cscript", ["//B", "//Nologo", vbsFile], { stdio: "ignore", timeout: 60_000 });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("parses under WSH, waits for the agent, and propagates a failure exit code", () => {
    // A parse error would surface as cscript's own exit code 1 regardless of
    // the fixture — 7 can only come out the far side via WScript.Quit.
    expect(withFixture(7)).toBe(7);
  });

  it("propagates a clean exit", () => {
    expect(withFixture(0)).toBe(0);
  });
});
