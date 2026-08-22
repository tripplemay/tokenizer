import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AUTH_SECRET_DEVELOPMENT_PLACEHOLDER } from "@/server/auth-secret";

const script = "scripts/validate-deploy-secrets.sh";

interface SecretOverrides {
  AUTH_SECRET?: string;
  AUTH_RESEND_KEY?: string;
  HARNESS_CONSOLE_SIGNING_KEY?: string;
}

function validate(overrides: SecretOverrides = {}) {
  return spawnSync("bash", [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      ...overrides
    }
  });
}

describe("deployment secret validation", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
    ["historical placeholder", AUTH_SECRET_DEVELOPMENT_PLACEHOLDER],
    ["too short", "short-secret-value"]
  ])("fails before deployment when AUTH_SECRET is %s", (_, secret) => {
    const result = validate({
      AUTH_SECRET: secret,
      AUTH_RESEND_KEY: "configured",
      HARNESS_CONSOLE_SIGNING_KEY: "configured"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("::error::AUTH_SECRET");
    if (secret) expect(result.stderr).not.toContain(secret);
  });

  it("only warns when optional feature secrets are missing", () => {
    const result = validate({
      AUTH_SECRET: "a-production-secret-with-at-least-32-characters"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("::warning::AUTH_RESEND_KEY");
    expect(result.stderr).toContain("::warning::HARNESS_CONSOLE_SIGNING_KEY");
    expect(result.stderr).not.toContain("::error::");
  });

  it("is invoked by the deploy job before SSH setup", () => {
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    const validation = workflow.indexOf("bash scripts/validate-deploy-secrets.sh");
    const sshSetup = workflow.indexOf("- name: Prepare SSH");

    expect(validation).toBeGreaterThan(-1);
    expect(sshSetup).toBeGreaterThan(validation);
  });
});
