import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quarantineUsageEvents } from "../../../src/cli/rejected-events";

const root = mkdtempSync(join(tmpdir(), "b06-quarantine-mode-"));
const previous = process.umask(0o022);
try {
  chmodSync(root, 0o755);
  const configDir = join(root, ".tokenizer");
  mkdirSync(configDir);
  const path = join(configDir, "rejected-usage.jsonl");
  quarantineUsageEvents([{
    code: "invalid_event",
    event: {
      source: "aider",
      sourceEventId: "private-session-id",
      occurredAt: "2026-10-08T00:00:00.000Z",
      workspacePath: "/private/workspace"
    }
  }], path);
  const mode = statSync(path).mode & 0o777;
  const dirMode = statSync(configDir).mode & 0o777;
  console.log(JSON.stringify({ directoryMode: dirMode.toString(8), fileMode: mode.toString(8),
    otherTraversableAndReadable: Boolean(dirMode & 0o001) && Boolean(mode & 0o004) }));
  assert.equal(dirMode, 0o755);
  assert.equal(mode, 0o644);
} finally {
  process.umask(previous);
  rmSync(root, { recursive: true, force: true });
}
