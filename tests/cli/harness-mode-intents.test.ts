import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseModeIntentRelayResponse,
  readModeDefaultsReportSummary,
  readPendingModeDefaults,
  stageHarnessModeIntent,
  type GitRunner,
  type RelayedModeIntent,
  type StageFileOperations
} from "@/cli/harness-mode-intents";
import { canonicalJson } from "@/server/harness-sign";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const REPO_KEY = "github.com/acme/repo";

let repo: string;
let privateKey: KeyObject;

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function write(rel: string, content: string): void {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    intent_id: "intent-1",
    repo_key: REPO_KEY,
    expected_head_sha: git(["rev-parse", "HEAD"]),
    desired: {
      execution: { profile: "fast", role_assignments: null },
      autonomy: { enabled: false }
    },
    issued_by: "owner@example.test",
    issued_at: "2026-07-27T11:00:00.000Z",
    intent_expires_at: "2026-07-28T12:00:00.000Z",
    ...overrides
  };
}

function relayItem(payload = basePayload()): RelayedModeIntent {
  return {
    projectId: "project-1",
    repoKey: REPO_KEY,
    intent: {
      ...payload,
      sig: edSign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64")
    } as RelayedModeIntent["intent"]
  };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mode-intent-stage-"));
  execFileSync("git", ["init", "-q", repo]);
  git(["config", "user.email", "agent@example.test"]);
  git(["config", "user.name", "Agent"]);
  git(["remote", "add", "origin", "https://github.com/acme/repo.git"]);

  const keys = generateKeyPairSync("ed25519");
  privateKey = keys.privateKey;
  write(".claude/console/console.pub", keys.publicKey.export({ type: "spki", format: "pem" }).toString());
  write("harness-rules.md", "# harness\n");
  write("harness.json", `${JSON.stringify({ framework: {}, project: { name: "fixture" } }, null, 2)}\n`);
  write("progress.json", `${JSON.stringify({ status: "building", role_assignments: null }, null, 2)}\n`);
  write("features.json", `${JSON.stringify({ sprint: "BL-TEST", features: [] }, null, 2)}\n`);
  git(["add", "-A"]);
  git(["commit", "-qm", "initial"]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("mode intent relay bounds", () => {
  it("accepts only the exact bounded relay envelope", () => {
    const item = relayItem();
    expect(parseModeIntentRelayResponse(JSON.stringify({ intents: [item] }))).toEqual([item]);
    expect(() => parseModeIntentRelayResponse(JSON.stringify({ intents: [item], stdout: "raw" }))).toThrow(
      "invalid_relay_response"
    );
    expect(() => parseModeIntentRelayResponse("x".repeat(64 * 1024 + 1))).toThrow("relay_response_too_large");
  });
});

describe("signed mode intent staging", () => {
  it("validates, atomically stages, and commits only harness.json", () => {
    const progressBefore = readFileSync(join(repo, "progress.json"), "utf8");
    const result = stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW);
    expect(result).toMatchObject({ status: "staged", idempotent: false, stagedAt: NOW.toISOString() });

    const harness = JSON.parse(readFileSync(join(repo, "harness.json"), "utf8"));
    expect(Object.keys(harness.project.mode_defaults).sort()).toEqual(["intent", "staged_at"]);
    expect(harness.project.mode_defaults.intent.intent_id).toBe("intent-1");
    expect(harness.project.mode_defaults).not.toHaveProperty("staged_commit_sha");
    expect(readFileSync(join(repo, "progress.json"), "utf8")).toBe(progressBefore);
    expect(git(["show", "--format=", "--name-only", "HEAD"])).toBe("harness.json");
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("commits only harness.json while preserving an unrelated staged file", () => {
    write("unrelated.txt", "already staged\n");
    git(["add", "unrelated.txt"]);

    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW)).toMatchObject({
      status: "staged"
    });
    expect(git(["show", "--format=", "--name-only", "HEAD"])).toBe("harness.json");
    expect(git(["diff", "--cached", "--name-only"])).toBe("unrelated.txt");
  });

  it("rejects a tampered signature without changing the target", () => {
    const item = relayItem();
    item.intent.issued_by = "attacker@example.test";
    const before = readFileSync(join(repo, "harness.json"), "utf8");
    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, item, NOW)).toMatchObject({
      status: "failed",
      failureCode: "invalid_signature"
    });
    expect(readFileSync(join(repo, "harness.json"), "utf8")).toBe(before);
  });

  it("requires relay, signed, and discovered repo keys to agree", () => {
    const item = relayItem(basePayload({ repo_key: "github.com/other/repo" }));
    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, item, NOW)).toMatchObject({
      status: "failed",
      failureCode: "repo_mismatch"
    });
  });

  it("rejects a full HEAD drift immediately before first staging", () => {
    const item = relayItem();
    write("unrelated.txt", "later\n");
    git(["add", "unrelated.txt"]);
    git(["commit", "-qm", "later"]);
    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, item, NOW)).toMatchObject({
      status: "failed",
      failureCode: "head_mismatch"
    });
  });

  it.each([
    [
      "expired_intent",
      { issued_at: "2026-07-27T10:00:00.000Z", intent_expires_at: "2026-07-27T11:59:59.000Z" }
    ],
    [
      "intent_not_yet_valid",
      { issued_at: "2026-07-27T12:00:01.000Z", intent_expires_at: "2026-07-28T12:00:00.000Z" }
    ]
  ])("rejects invalid time window %s", (failureCode, times) => {
    const item = relayItem(basePayload(times));
    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, item, NOW)).toMatchObject({
      status: "failed",
      failureCode
    });
  });

  it("requires harness.json to be clean", () => {
    write("harness.json", `${readFileSync(join(repo, "harness.json"), "utf8")}\n`);
    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW)).toMatchObject({
      status: "failed",
      failureCode: "harness_dirty"
    });
  });

  it("retries the exact staged intent without comparing its old HEAD or creating a commit", () => {
    const item = relayItem();
    const first = stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, item, NOW);
    expect(first.status).toBe("staged");
    const stagedCommit = git(["rev-parse", "HEAD"]);
    const commitCount = Number(git(["rev-list", "--count", "HEAD"]));

    write("later.txt", "post-stage\n");
    git(["add", "later.txt"]);
    git(["commit", "-qm", "post-stage"]);
    const retry = stageHarnessModeIntent(
      { path: repo, repoKey: REPO_KEY },
      item,
      new Date("2026-07-27T12:01:00.000Z")
    );
    expect(retry).toMatchObject({
      status: "staged",
      idempotent: true,
      stagedAt: NOW.toISOString(),
      stagedCommitSha: stagedCommit
    });
    expect(Number(git(["rev-list", "--count", "HEAD"]))).toBe(commitCount + 1);
    expect(git(["log", "-1", "--format=%s"])).toBe("post-stage");
  });

  it("does not report failure after commit success and completes the next exact retry idempotently", () => {
    const item = relayItem();
    let committed = false;
    let failVerificationOnce = true;
    const transientGit: GitRunner = (args, cwd) => {
      const result = execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      if (args[0] === "commit") committed = true;
      if (committed && failVerificationOnce && args[0] === "status") {
        failVerificationOnce = false;
        throw new Error("simulated post-commit readback failure");
      }
      return result;
    };

    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, item, NOW, transientGit)).toMatchObject({
      status: "ack_pending",
      intentId: "intent-1"
    });
    expect(git(["show", "--format=", "--name-only", "HEAD"])).toBe("harness.json");

    const retry = stageHarnessModeIntent(
      { path: repo, repoKey: REPO_KEY },
      item,
      new Date("2026-07-27T12:01:00.000Z")
    );
    expect(retry).toMatchObject({ status: "staged", idempotent: true, stagedAt: NOW.toISOString() });
  });

  it("recognizes a commit that succeeded immediately before the runner threw", () => {
    const commitThenThrow: GitRunner = (args, cwd) => {
      const result = execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      if (args[0] === "commit") throw new Error("simulated transport loss after commit");
      return result;
    };
    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW, commitThenThrow)).toMatchObject({
      status: "staged",
      idempotent: false
    });
  });

  it.each(["write", "readback"] as const)("restores the original harness after a first-stage %s failure", (failure) => {
    const before = readFileSync(join(repo, "harness.json"), "utf8");
    let stagedWrite = false;
    let failed = false;
    const files: StageFileOperations = {
      read: (path) => {
        if (failure === "readback" && stagedWrite && !failed) {
          failed = true;
          throw new Error("simulated readback failure");
        }
        return readFileSync(path, "utf8");
      },
      write: (path, content) => {
        writeFileSync(path, content);
        if (!stagedWrite) {
          stagedWrite = true;
          if (failure === "write") {
            failed = true;
            throw new Error("simulated write failure after replacement");
          }
        }
      }
    };

    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW, undefined, files)).toMatchObject({
      status: "failed",
      failureCode: "harness_write_failed"
    });
    expect(readFileSync(join(repo, "harness.json"), "utf8")).toBe(before);
    expect(git(["status", "--porcelain", "--", "harness.json"])).toBe("");
  });

  it("restores after git add failure without disturbing an unrelated staged file", () => {
    const before = readFileSync(join(repo, "harness.json"), "utf8");
    write("unrelated.txt", "already staged\n");
    git(["add", "unrelated.txt"]);
    const addFailure: GitRunner = (args, cwd) => {
      if (args[0] === "add") throw new Error("simulated add failure");
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    };

    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW, addFailure)).toMatchObject({
      status: "failed",
      failureCode: "git_add_failed"
    });
    expect(readFileSync(join(repo, "harness.json"), "utf8")).toBe(before);
    expect(git(["diff", "--cached", "--name-only"])).toBe("unrelated.txt");
  });

  it("does not report defaults copied into a repository with a different normalized identity", () => {
    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW).status).toBe("staged");
    expect(readPendingModeDefaults(repo, NOW)?.intentId).toBe("intent-1");

    const copiedRepo = mkdtempSync(join(tmpdir(), "mode-intent-copied-"));
    try {
      execFileSync("git", ["init", "-q", copiedRepo]);
      execFileSync("git", ["remote", "add", "origin", "https://github.com/other/repo.git"], { cwd: copiedRepo });
      mkdirSync(join(copiedRepo, ".claude", "console"), { recursive: true });
      cpSync(join(repo, ".claude", "console", "console.pub"), join(copiedRepo, ".claude", "console", "console.pub"));
      cpSync(join(repo, "harness.json"), join(copiedRepo, "harness.json"));

      expect(readPendingModeDefaults(copiedRepo, NOW)).toBeNull();
      expect(readModeDefaultsReportSummary(copiedRepo, NOW)).toBeNull();
    } finally {
      rmSync(copiedRepo, { recursive: true, force: true });
    }
  });

  it("rolls back a commit failure and never stages an unrelated file", () => {
    const before = readFileSync(join(repo, "harness.json"), "utf8");
    write("unrelated.txt", "must remain staged\n");
    git(["add", "unrelated.txt"]);
    const failingGit: GitRunner = (args, cwd) => {
      if (args[0] === "commit") throw new Error("simulated commit failure with private detail");
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    };

    expect(stageHarnessModeIntent({ path: repo, repoKey: REPO_KEY }, relayItem(), NOW, failingGit)).toMatchObject({
      status: "failed",
      failureCode: "git_commit_failed"
    });
    expect(readFileSync(join(repo, "harness.json"), "utf8")).toBe(before);
    expect(git(["diff", "--cached", "--name-only"])).toBe("unrelated.txt");
  });
});
