import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signDecision, type HarnessDecisionPayload } from "@/server/harness-sign";

const fixturesDir = process.env.CONTRACT_FIXTURES_DIR;
const fixturesAvailable = Boolean(fixturesDir && existsSync(fixturesDir));

function findOpenSsl(): string | null {
  for (const candidate of [
    process.env.HARNESS_OPENSSL,
    "/opt/homebrew/opt/openssl@3/bin/openssl",
    "openssl"
  ]) {
    if (!candidate) continue;
    try {
      const algorithms = execFileSync(candidate, ["list", "-public-key-algorithms"], {
        stdio: ["ignore", "pipe", "ignore"]
      });
      if (algorithms.toString().toUpperCase().includes("ED25519")) return candidate;
    } catch {
      // Try the next supported OpenSSL location.
    }
  }
  return null;
}

const openssl = findOpenSsl();
let tempDir = "";
let validator = "";
let previousSigningKey: string | undefined;

function fixturePath(...parts: string[]): string {
  if (!fixturesDir) throw new Error("CONTRACT_FIXTURES_DIR is not configured");
  return join(fixturesDir, ...parts);
}

function progressFor(payload: HarnessDecisionPayload) {
  return {
    status: "verifying",
    pending_gate: {
      id: payload.gate_id,
      kind: "phase_advance",
      raised_at: "2026-08-09T00:00:00Z",
      raised_by: "verify",
      batch: "CF-NODE",
      from_status: "verifying",
      to_status: "done",
      detail: "Node-issued contract decision",
      evidence: [],
      decision: { ...payload, sig: signDecision(payload) }
    }
  };
}

function runValidator(mode: "schema" | "guard", progressPath: string) {
  return spawnSync("bash", [validator, mode, progressPath], {
    encoding: "utf8",
    env: { ...process.env, HARNESS_OPENSSL: openssl! }
  });
}

const CASES: HarnessDecisionPayload[] = [
  {
    gate_id: "CF-NODE-verifying-done-w1",
    action: "approve",
    by: "contract-test@example.invalid",
    at: "2026-08-09T00:00:00Z",
    note: "中文 note A"
  },
  {
    gate_id: "CF-NODE-verifying-done-w2",
    action: "reject",
    by: "contract-test@example.invalid",
    at: "2026-08-09T00:01:00Z",
    scope: { expires_at: "2026-08-10T00:00:00Z", once: true }
  }
];

describe.skipIf(!fixturesAvailable || !openssl)("contract fixtures: Node signing to framework verification", () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "contract-sign-verify-"));
    const consoleDir = join(tempDir, "console");
    mkdirSync(consoleDir);

    const frameworkRoot = resolve(fixturesDir!, "..");
    validator = join(consoleDir, "validate-pending-gate.sh");
    copyFileSync(
      join(frameworkRoot, "templates", "claude", "console", "validate-pending-gate.sh"),
      validator
    );
    chmodSync(validator, 0o755);
    copyFileSync(fixturePath("keys", "test-console.pub"), join(consoleDir, "console.pub"));

    previousSigningKey = process.env.HARNESS_CONSOLE_SIGNING_KEY;
    process.env.HARNESS_CONSOLE_SIGNING_KEY = readFileSync(
      fixturePath("keys", "test-console.key"),
      "utf8"
    );
  });

  afterAll(() => {
    if (previousSigningKey === undefined) delete process.env.HARNESS_CONSOLE_SIGNING_KEY;
    else process.env.HARNESS_CONSOLE_SIGNING_KEY = previousSigningKey;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it.each(CASES)("accepts a tokenizer-issued decision for $gate_id", (payload) => {
    const progressPath = join(tempDir, `${payload.gate_id}.json`);
    writeFileSync(progressPath, `${JSON.stringify(progressFor(payload), null, 2)}\n`);

    for (const mode of ["schema", "guard"] as const) {
      const result = runValidator(mode, progressPath);
      expect(
        result.status,
        `${mode} stdout=${result.stdout.trim()} stderr=${result.stderr.trim()}`
      ).toBe(0);
    }
  });

  it("rejects a one-byte mutation of a signed field", () => {
    const progress = progressFor(CASES[0]);
    progress.pending_gate.decision.note = "中文 note B";
    const progressPath = join(tempDir, "tampered-progress.json");
    writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);

    const result = runValidator("guard", progressPath);
    expect(
      result.status,
      `guard stdout=${result.stdout.trim()} stderr=${result.stderr.trim()}`
    ).not.toBe(0);
  });
});
