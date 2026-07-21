import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { buildTaskXml, encodeTaskXml, registerTask, TASK_NAME } from "@/cli/service-windows";

const options = {
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  scriptPath: "C:\\Users\\me\\.tokenizer\\app\\src\\cli\\index.ts",
  workingDir: "C:\\Users\\me\\.tokenizer\\app",
  heartbeatSeconds: 60,
  syncMinutes: 15,
  userId: "MACHINE\\me"
};

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

  it("restarts on failure, which is what replaces launchd KeepAlive", () => {
    const xml = buildTaskXml(options);
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<Interval>PT1M</Interval>");
  });

  it("triggers at logon rather than on a polling interval", () => {
    expect(buildTaskXml(options)).toContain("<LogonTrigger>");
  });

  it("refuses to stack duplicate instances", () => {
    expect(buildTaskXml(options)).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
  });

  it("runs unelevated in the user's session so %USERPROFILE% resolves correctly", () => {
    const xml = buildTaskXml(options);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  });

  it("invokes node by absolute path with the tsx loader", () => {
    const xml = buildTaskXml(options);
    expect(xml).toContain("<Command>C:\\Program Files\\nodejs\\node.exe</Command>");
    expect(xml).toContain("--import tsx");
    expect(xml).toContain("agent --heartbeat-seconds 60 --sync-minutes 15");
  });

  it("sets the working directory so tsx resolves", () => {
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

describe("encodeTaskXml", () => {
  it("emits UTF-16 with a BOM", () => {
    // schtasks rejects UTF-8 with an unhelpful "task XML is malformed".
    const buffer = encodeTaskXml("<Task/>");
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
    const xml = buildTaskXml({ ...options, nodePath: process.execPath, userId: null });
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
