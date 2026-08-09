import { createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/server/harness-sign";
import { validateHarnessModeIntentPayload } from "@/shared/harness-mode-intent";

type FixtureExpectation = "valid" | "invalid";

type PendingGateFixture = {
  name: string;
  expect: FixtureExpectation;
  pending_gate: unknown;
};

type ModeIntentFixture = {
  name: string;
  expect: FixtureExpectation;
  mode_defaults: unknown;
};

type UnknownRecord = Record<string, unknown>;

const fixturesDir = process.env.CONTRACT_FIXTURES_DIR;
const fixturesAvailable = Boolean(fixturesDir && existsSync(fixturesDir));
const KINDS = new Set([
  "phase_advance",
  "l2_auth",
  "adjudication",
  "debias_conflict",
  "scope_drift",
  "budget",
  "spec_lock",
  "other"
]);
const RAISED_BY = new Set(["autodriver", "verify", "build", "plan", "dispatch"]);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function fixturePath(...parts: string[]): string {
  if (!fixturesDir) throw new Error("CONTRACT_FIXTURES_DIR is not configured");
  return join(fixturesDir, ...parts);
}

function readFixtures<T>(contract: "pending-gate" | "mode-intent", expectation: FixtureExpectation): T[] {
  const directory = fixturePath(contract, expectation);
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as T);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): UnknownRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as UnknownRecord;
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) return null;
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  return record;
}

function record(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPendingGateShape(value: unknown): value is UnknownRecord {
  const gate = exactRecord(
    value,
    ["id", "kind", "raised_at", "raised_by", "batch", "detail"],
    ["from_status", "to_status", "evidence", "decision"]
  );
  if (!gate) return false;
  if (!nonBlank(gate.id) || gate.id.length < 8) return false;
  if (typeof gate.kind !== "string" || !KINDS.has(gate.kind)) return false;
  if (typeof gate.raised_by !== "string" || !RAISED_BY.has(gate.raised_by)) return false;
  if (!nonBlank(gate.raised_at) || !UTC_TIMESTAMP.test(gate.raised_at)) return false;
  if (!nonBlank(gate.batch) || !nonBlank(gate.detail)) return false;
  if (gate.from_status !== undefined && gate.from_status !== null && typeof gate.from_status !== "string") return false;
  if (gate.to_status !== undefined && gate.to_status !== null && typeof gate.to_status !== "string") return false;
  if (gate.evidence !== undefined && (!Array.isArray(gate.evidence) || gate.evidence.some((item) => typeof item !== "string"))) {
    return false;
  }

  const decision = exactRecord(
    gate.decision,
    ["gate_id", "action", "by", "at"],
    ["note", "scope", "sig"]
  );
  if (!decision || decision.gate_id !== gate.id) return false;
  if (decision.action !== "approve" && decision.action !== "reject") return false;
  if (!nonBlank(decision.by) || !nonBlank(decision.at) || !UTC_TIMESTAMP.test(decision.at)) return false;
  if (decision.note !== undefined && typeof decision.note !== "string") return false;
  if (decision.sig !== undefined && typeof decision.sig !== "string") return false;

  if (decision.scope !== undefined) {
    const scope = exactRecord(decision.scope, [], ["once", "expires_at"]);
    if (!scope) return false;
    if (scope.once !== undefined && typeof scope.once !== "boolean") return false;
    if (scope.expires_at !== undefined && (typeof scope.expires_at !== "string" || !UTC_TIMESTAMP.test(scope.expires_at))) {
      return false;
    }
  }
  return true;
}

function signatureBytes(value: unknown): Buffer | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 64 ? bytes : null;
}

function verifySignedRecord(value: UnknownRecord, publicKey: ReturnType<typeof createPublicKey>): boolean {
  const signature = signatureBytes(value.sig);
  if (!signature) return false;
  const { sig: _sig, ...payload } = value;
  try {
    return edVerify(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      publicKey,
      signature
    );
  } catch {
    return false;
  }
}

function acceptsPendingGate(value: unknown, publicKey: ReturnType<typeof createPublicKey>): boolean {
  if (!validPendingGateShape(value)) return false;
  return verifySignedRecord(value.decision as UnknownRecord, publicKey);
}

function acceptsModeIntent(value: unknown, publicKey: ReturnType<typeof createPublicKey>): boolean {
  const defaults = exactRecord(value, ["intent", "staged_at"]);
  if (!defaults || typeof defaults.staged_at !== "string" || !UTC_TIMESTAMP.test(defaults.staged_at)) return false;
  const intent = record(defaults.intent);
  if (!intent || !verifySignedRecord(intent, publicKey)) return false;
  const { sig: _sig, ...payload } = intent;
  return validateHarnessModeIntentPayload(payload, { now: "2026-08-09T01:00:00Z" }).ok;
}

describe.skipIf(!fixturesAvailable)("contract fixtures: framework payload ingestion", () => {
  it("accepts every valid pending gate and rejects every invalid pending gate", () => {
    const publicKey = createPublicKey(readFileSync(fixturePath("keys", "test-console.pub"), "utf8"));
    const fixtures = [
      ...readFixtures<PendingGateFixture>("pending-gate", "valid"),
      ...readFixtures<PendingGateFixture>("pending-gate", "invalid")
    ];

    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(
        acceptsPendingGate(fixture.pending_gate, publicKey),
        `pending-gate fixture ${fixture.name}`
      ).toBe(fixture.expect === "valid");
    }
  });

  it("accepts every valid mode intent and rejects every invalid mode intent", () => {
    const publicKey = createPublicKey(readFileSync(fixturePath("keys", "test-console.pub"), "utf8"));
    const fixtures = [
      ...readFixtures<ModeIntentFixture>("mode-intent", "valid"),
      ...readFixtures<ModeIntentFixture>("mode-intent", "invalid")
    ];

    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(
        acceptsModeIntent(fixture.mode_defaults, publicKey),
        `mode-intent fixture ${fixture.name}`
      ).toBe(fixture.expect === "valid");
    }
  });
});
