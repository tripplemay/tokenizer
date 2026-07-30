import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDiagnostics } from "@/cli/sync";
import { updateState } from "@/cli/config";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(state: string) {
  const root = mkdtempSync(join(tmpdir(), "tokenizer-harness-heartbeat-"));
  roots.push(root);
  const stateFile = join(root, "state.json");
  const queueFile = join(root, "queue.jsonl");
  writeFileSync(stateFile, state);
  writeFileSync(queueFile, "one\ntwo\n");
  return { state: stateFile, queue: queueFile };
}

describe("local heartbeat Harness snapshot", () => {
  it("includes an exact valid snapshot", () => {
    const harness = {
      attemptedAt: "2026-07-30T12:00:00.000Z",
      status: "success",
      reported: 3,
      failed: 0,
      relayed: 1,
      modeIntents: 0,
      issues: []
    };
    const diagnostics = readDiagnostics(fixture(JSON.stringify({ harness, lastSyncStatus: "success" })));
    expect(diagnostics.queueDepth).toBe(2);
    expect(diagnostics.harness).toEqual(harness);
  });

  it("omits Harness diagnostics when state is corrupt or the nested snapshot is invalid", () => {
    expect(readDiagnostics(fixture("{torn")).harness).toBeUndefined();
    expect(readDiagnostics(fixture(JSON.stringify({ harness: { status: "failed", detail: "/private/path" } }))).harness)
      .toBeUndefined();
  });

  it("atomically recovers a corrupt state file when persisting the next snapshot", () => {
    const paths = fixture("{torn");
    const harness = {
      attemptedAt: "2026-07-30T12:00:00.000Z",
      status: "failed",
      reported: 0,
      failed: 1,
      relayed: 0,
      modeIntents: 0,
      issues: [{ operation: "report", project: "tokenizer", code: "network_error", retryable: true }]
    };
    updateState({ harness }, paths.state);
    expect(JSON.parse(readFileSync(paths.state, "utf8"))).toEqual({ harness });
    expect(readDiagnostics(paths).harness).toEqual(harness);
  });
});
