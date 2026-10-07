import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AUTH_SECRET_DEVELOPMENT_PLACEHOLDER } from "@/server/auth-secret";

const script = "scripts/validate-deploy-secrets.sh";

interface SecretOverrides {
  VPS_HOST?: string;
  VPS_USER?: string;
  VPS_SSH_KEY?: string;
  VPS_DEPLOY_PATH?: string;
  VPS_SSH_PORT?: string;
  AUTH_SECRET?: string;
  ADMIN_TOKEN?: string;
  AUTH_RESEND_KEY?: string;
  HARNESS_CONSOLE_SIGNING_KEY?: string;
  POSTGRES_PASSWORD?: string;
  NEXT_PUBLIC_APP_URL?: string;
  PRICING_LLM_KEY?: string;
}

function validate(overrides: SecretOverrides = {}) {
  return spawnSync("bash", [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      VPS_HOST: "token.example.test",
      VPS_USER: "deploy",
      VPS_SSH_KEY: "synthetic-key",
      ADMIN_TOKEN: "admin-token-with-at-least-thirty-two-characters",
      AUTH_RESEND_KEY: "re_configured",
      POSTGRES_PASSWORD: "existing-db-password",
      NEXT_PUBLIC_APP_URL: "https://token.example.test",
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
      ADMIN_TOKEN: "a-production-admin-token-with-at-least-32-characters",
      AUTH_RESEND_KEY: "configured",
      HARNESS_CONSOLE_SIGNING_KEY: "configured"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("::error::AUTH_SECRET");
    if (secret) expect(result.stderr).not.toContain(secret);
  });

  it.each([
    ["missing", undefined],
    ["historical placeholder", "change-me"],
    ["too short", "short-token"],
    ["whitespace-padded", " a-production-admin-token-with-at-least-32-characters"]
  ])("rejects %s ADMIN_TOKEN", (_, token) => {
    const result = validate({
      AUTH_SECRET: "a-production-secret-with-at-least-32-characters",
      ADMIN_TOKEN: token,
      AUTH_RESEND_KEY: "configured"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("::error::ADMIN_TOKEN");
    if (token) expect(result.stderr).not.toContain(token);
  });

  it.each([undefined, "", "   "])("rejects a missing or blank magic-link key: %s", (key) => {
    const result = validate({
      AUTH_SECRET: "a-production-secret-with-at-least-32-characters",
      ADMIN_TOKEN: "a-production-admin-token-with-at-least-32-characters",
      AUTH_RESEND_KEY: key
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("::error::AUTH_RESEND_KEY");
  });

  it("accepts required secrets and warns only for optional signing", () => {
    const result = validate({
      AUTH_SECRET: "a-production-secret-with-at-least-32-characters",
      ADMIN_TOKEN: "a-production-admin-token-with-at-least-32-characters",
      AUTH_RESEND_KEY: "configured"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("::warning::HARNESS_CONSOLE_SIGNING_KEY");
    expect(result.stderr).not.toContain("::error::");
  });

  it.each([
    ["ADMIN_TOKEN", "change-me"],
    ["AUTH_RESEND_KEY", ""],
    ["POSTGRES_PASSWORD", ""],
    ["POSTGRES_PASSWORD", "password@unsafe"],
    ["NEXT_PUBLIC_APP_URL", "http://token.example.test"]
  ] as const)("rejects invalid required production value %s", (name, value) => {
    const result = validate({ AUTH_SECRET: "a-production-secret-with-at-least-32-characters", [name]: value });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`::error::${name}`);
    expect(result.stderr).not.toContain(value === "" ? "invalid-secret-value" : value);
  });

  it.each(["\nADMIN_TOKEN=injected", "\rINJECTED=1", "safe # truncated", "$OTHER_SECRET", "'quoted'", '"quoted"', "\\escape"])(
    "rejects unsafe .env characters without echoing the value: %j",
    (suffix) => {
      const secret = `safe-secret-with-at-least-32-characters${suffix}`;
      const result = validate({ AUTH_SECRET: secret });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("::error::AUTH_SECRET");
      expect(result.stderr).not.toContain(secret);
      expect(result.stdout).not.toContain(secret);
    }
  );

  it.each([
    ["VPS_HOST", "host'echo leaked"],
    ["VPS_USER", "deploy;id"],
    ["VPS_DEPLOY_PATH", "/opt/tokenizer';id"],
    ["VPS_SSH_PORT", "22 -o ProxyCommand=id"],
    ["VPS_SSH_KEY", ""]
  ] as const)("rejects unsafe VPS connection setting %s", (name, value) => {
    const result = validate({ AUTH_SECRET: "a-production-secret-with-at-least-32-characters", [name]: value });
    expect(result.status).not.toBe(0);
    if (value) expect(result.stderr).not.toContain(value);
  });

  it("is invoked by the deploy job before SSH setup", () => {
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    const validation = workflow.indexOf("bash scripts/validate-deploy-secrets.sh");
    const sshSetup = workflow.indexOf("- name: Prepare SSH");

    expect(validation).toBeGreaterThan(-1);
    expect(sshSetup).toBeGreaterThan(validation);
    expect(workflow).toContain("POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}");
    expect(workflow).toContain("umask 077");
    expect(workflow).toContain('printf \'%s\\n\' "$VPS_SSH_KEY"');
    expect(workflow).not.toContain("${{ secrets.VPS_SSH_KEY }}\" >");
    expect(workflow).not.toContain("postgresql://tokenizer:tokenizer@localhost");
  });
});
