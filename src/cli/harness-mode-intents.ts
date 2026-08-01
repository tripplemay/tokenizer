import { execFileSync } from "node:child_process";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, withFileLock } from "./atomic-file";
import { readDispatchToolCatalog } from "./harness-tool-catalog";
import { canonicalJson } from "@/server/harness-sign";
import {
  normalizeHarnessRepoKey,
  validateHarnessModeIntentPayload,
  type HarnessModeAgentDescriptor,
  type HarnessModeIntentPayload,
  type HarnessSignedModeIntent,
  type HarnessTransport
} from "@/shared/harness-mode-intent";
import { toolCatalogModeDescriptors } from "@/shared/harness-tool-catalog";

const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_RELAY_BYTES = 64 * 1024;
const MAX_RELAY_ITEMS = 50;

type UnknownRecord = Record<string, unknown>;

export type HarnessRepoTarget = {
  path: string;
  repoKey: string;
};

export type RelayedModeIntent = {
  projectId: string;
  repoKey: string;
  intent: HarnessSignedModeIntent;
};

export type StagedModeIntentResult =
  | {
      status: "staged";
      projectId: string;
      intentId: string;
      stagedAt: string;
      stagedCommitSha: string;
      idempotent: boolean;
    }
  | {
      status: "ack_pending";
      projectId: string;
      intentId: string;
      stagedAt: string;
    }
  | {
      status: "failed";
      projectId: string;
      intentId: string;
      failedAt: string;
      failureCode: string;
    };

export type PendingModeDefaultsSummary = {
  intentId: string;
  stagedAt: string;
  intentExpiresAt: string;
  execution: {
    profile: "fast" | "heterogeneous" | "slow";
    roleAssignments: { generator: string; evaluator: string } | null;
    roleBindings: {
      planner: { tool: string; invocation: HarnessTransport } | null;
      generator: { tool: string; invocation: HarnessTransport };
      evaluator: { tool: string; invocation: HarnessTransport };
    } | null;
  };
  autonomy: { enabled: boolean; expiresAt: string | null };
};

export type ModeDefaultsReportSummary = {
  intentId: string;
  stagedAt: string;
  stagedCommitSha: string;
};

export type GitRunner = (args: string[], cwd: string) => string;

export type StageFileOperations = {
  read(path: string): string;
  write(path: string, content: string): void;
};

const stageFiles: StageFileOperations = {
  read: (path) => readFileSync(path, "utf8"),
  write: writeFileAtomic
};

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function hasExactKeys(value: UnknownRecord, required: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > max) return null;
  return value;
}

function assertBoundedJson(value: unknown, depth = 0, state = { nodes: 0 }): void {
  state.nodes += 1;
  if (depth > 12 || state.nodes > 5_000) throw new Error("relay_payload_too_complex");
  if (typeof value === "string" && value.length > 4_096) throw new Error("relay_string_too_long");
  if (Array.isArray(value)) {
    for (const item of value) assertBoundedJson(item, depth + 1, state);
    return;
  }
  const object = record(value);
  if (object) {
    for (const [key, item] of Object.entries(object)) {
      if (key.length > 128) throw new Error("relay_key_too_long");
      assertBoundedJson(item, depth + 1, state);
    }
  }
}

/** Parse the relay as hostile input before any repository lookup or write. */
export function parseModeIntentRelayResponse(raw: string): RelayedModeIntent[] {
  if (Buffer.byteLength(raw, "utf8") > MAX_RELAY_BYTES) throw new Error("relay_response_too_large");
  const decoded = JSON.parse(raw) as unknown;
  assertBoundedJson(decoded);
  const body = record(decoded);
  if (!body || !hasExactKeys(body, ["intents"]) || !Array.isArray(body.intents)) {
    throw new Error("invalid_relay_response");
  }
  if (body.intents.length > MAX_RELAY_ITEMS) throw new Error("too_many_relay_items");

  return body.intents.map((rawItem) => {
    const item = record(rawItem);
    if (!item || !hasExactKeys(item, ["projectId", "repoKey", "intent"])) {
      throw new Error("invalid_relay_item");
    }
    const projectId = boundedString(item.projectId, 128);
    const repoKey = boundedString(item.repoKey, 512);
    const intent = record(item.intent);
    if (
      !projectId ||
      !repoKey ||
      !intent ||
      !hasExactKeys(intent, [
        "intent_id",
        "repo_key",
        "expected_head_sha",
        "desired",
        "issued_by",
        "issued_at",
        "intent_expires_at",
        "sig"
      ]) ||
      !boundedString(intent.intent_id, 128) ||
      !boundedString(intent.sig, 1_024)
    ) {
      throw new Error("invalid_relay_item");
    }
    return { projectId, repoKey, intent: intent as HarnessSignedModeIntent };
  });
}

function signatureBytes(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 64 ? bytes : null;
}

export function verifySignedModeIntent(repoPath: string, intent: HarnessSignedModeIntent): boolean {
  const publicKeyPath = join(repoPath, ".claude", "console", "console.pub");
  if (!existsSync(publicKeyPath)) return false;
  const signature = signatureBytes(intent.sig);
  if (!signature) return false;
  const { sig: _sig, ...payload } = intent;
  try {
    return edVerify(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      createPublicKey(readFileSync(publicKeyPath, "utf8")),
      signature
    );
  } catch {
    return false;
  }
}

function readRegistryModeContext(repoPath: string): {
  agents: HarnessModeAgentDescriptor[] | undefined;
  tools: ReturnType<typeof toolCatalogModeDescriptors> | undefined;
} {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(repoPath, ".agents-registry.json"), "utf8"));
  } catch {
    return { agents: undefined, tools: undefined };
  }
  const registry = record(value);
  if (!registry) {
    return { agents: undefined, tools: undefined };
  }
  const agents = Array.isArray(registry.agents) && registry.agents.length <= 50
    ? registry.agents.map((rawAgent) => {
        const agent = record(rawAgent) ?? {};
        return {
          id: typeof agent.id === "string" ? agent.id : "",
          roles: Array.isArray(agent.roles) ? agent.roles.filter((role): role is string => typeof role === "string") : [],
          transport: agent.transport as HarnessTransport,
          model_family: typeof agent.model_family === "string" ? agent.model_family : ""
        };
      })
    : undefined;
  const catalog = readDispatchToolCatalog(repoPath);
  return {
    agents,
    // A v2 Planner may be Coordinator (null), so a usable catalog need only
    // cover the roles explicitly bound by the signed payload. The payload
    // validator below still rejects every selected tool absent from this list.
    tools: catalog.issue ? undefined : toolCatalogModeDescriptors(catalog.entries)
  };
}

function failure(item: RelayedModeIntent, now: Date, failureCode: string): StagedModeIntentResult {
  return {
    status: "failed",
    projectId: item.projectId,
    intentId: typeof item.intent.intent_id === "string" ? item.intent.intent_id.slice(0, 128) : "invalid",
    failedAt: now.toISOString(),
    failureCode: failureCode.slice(0, 64)
  };
}

function parseHarnessDocument(raw: string): { document: UnknownRecord; project: UnknownRecord } | null {
  try {
    const document = record(JSON.parse(raw));
    const project = document ? record(document.project) : null;
    return document && project ? { document, project } : null;
  } catch {
    return null;
  }
}

function exactStoredIntent(project: UnknownRecord, intent: HarnessSignedModeIntent): { stagedAt: string } | null {
  const defaults = record(project.mode_defaults);
  if (!defaults || !hasExactKeys(defaults, ["intent", "staged_at"])) return null;
  const stagedAt = boundedString(defaults.staged_at, 40);
  if (!stagedAt || !UTC_TIMESTAMP_PATTERN.test(stagedAt)) return null;
  return canonicalJson(defaults.intent) === canonicalJson(intent) ? { stagedAt } : null;
}

function checkedFullSha(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return HEAD_SHA_PATTERN.test(normalized) ? normalized : null;
}

function restoreHarnessFile(
  repoPath: string,
  harnessPath: string,
  original: string,
  git: GitRunner,
  files: StageFileOperations
): boolean {
  try {
    files.write(harnessPath, original);
    if (files.read(harnessPath) !== original) return false;
    git(["reset", "-q", "HEAD", "--", "harness.json"], repoPath);
    return git(["status", "--porcelain", "--", "harness.json"], repoPath) === "";
  } catch {
    return false;
  }
}

function committedHarnessStage(
  repoPath: string,
  harnessPath: string,
  expected: string,
  git: GitRunner,
  files: StageFileOperations
): string | null {
  try {
    if (files.read(harnessPath) !== expected) return null;
    if (git(["status", "--porcelain", "--", "harness.json"], repoPath) !== "") return null;
    return checkedFullSha(git(["log", "-1", "--format=%H", "--", "harness.json"], repoPath));
  } catch {
    return null;
  }
}

/**
 * Validate and stage one signed intent. The expected HEAD check deliberately occurs only
 * on the first stage, immediately before the atomic write; an exact retry recovers the
 * original commit from git history and reuses the recorded staged_at.
 */
export function stageHarnessModeIntent(
  repo: HarnessRepoTarget,
  item: RelayedModeIntent,
  now: Date = new Date(),
  git: GitRunner = runGit,
  files: StageFileOperations = stageFiles
): StagedModeIntentResult {
  if (!verifySignedModeIntent(repo.path, item.intent)) return failure(item, now, "invalid_signature");

  const { sig: _sig, ...rawPayload } = item.intent;
  const registry = readRegistryModeContext(repo.path);
  const validation = validateHarnessModeIntentPayload(rawPayload, { now, ...registry });
  if (validation.ok === false) return failure(item, now, validation.error.code);
  if (Date.parse(validation.value.issued_at) > now.getTime()) {
    return failure(item, now, "intent_not_yet_valid");
  }

  try {
    const relayRepoKey = normalizeHarnessRepoKey(item.repoKey);
    const signedRepoKey = normalizeHarnessRepoKey(validation.value.repo_key);
    const discoveredRepoKey = normalizeHarnessRepoKey(repo.repoKey);
    if (relayRepoKey !== signedRepoKey || relayRepoKey !== discoveredRepoKey) {
      return failure(item, now, "repo_mismatch");
    }
  } catch {
    return failure(item, now, "repo_mismatch");
  }

  const harnessPath = join(repo.path, "harness.json");
  try {
    return withFileLock(harnessPath, () => {
      let dirty: string;
      try {
        dirty = git(["status", "--porcelain", "--", "harness.json"], repo.path);
      } catch {
        return failure(item, now, "git_status_failed");
      }
      if (dirty !== "") return failure(item, now, "harness_dirty");

      let original: string;
      try {
        original = files.read(harnessPath);
      } catch {
        return failure(item, now, "harness_read_failed");
      }
      const parsed = parseHarnessDocument(original);
      if (!parsed) return failure(item, now, "harness_invalid");

      const retry = exactStoredIntent(parsed.project, item.intent);
      if (retry) {
        try {
          const commit = checkedFullSha(git(["log", "-1", "--format=%H", "--", "harness.json"], repo.path));
          if (!commit) return failure(item, now, "staged_commit_missing");
          return {
            status: "staged",
            projectId: item.projectId,
            intentId: validation.value.intent_id,
            stagedAt: retry.stagedAt,
            stagedCommitSha: commit,
            idempotent: true
          };
        } catch {
          return failure(item, now, "staged_commit_missing");
        }
      }

      let head: string | null;
      try {
        head = checkedFullSha(git(["rev-parse", "HEAD"], repo.path));
      } catch {
        return failure(item, now, "head_unavailable");
      }
      if (!head || head !== validation.value.expected_head_sha) return failure(item, now, "head_mismatch");

      const stagedAt = now.toISOString();
      parsed.project.mode_defaults = { intent: item.intent, staged_at: stagedAt };
      const next = `${JSON.stringify(parsed.document, null, 2)}\n`;
      try {
        files.write(harnessPath, next);
        if (files.read(harnessPath) !== next) throw new Error("write verification failed");
      } catch {
        const restored = restoreHarnessFile(repo.path, harnessPath, original, git, files);
        return failure(item, now, restored ? "harness_write_failed" : "rollback_failed");
      }

      try {
        git(["add", "--", "harness.json"], repo.path);
        if (git(["diff", "--cached", "--name-only", "--", "harness.json"], repo.path) !== "harness.json") {
          throw new Error("target was not staged");
        }
      } catch {
        const restored = restoreHarnessFile(repo.path, harnessPath, original, git, files);
        return failure(item, now, restored ? "git_add_failed" : "rollback_failed");
      }

      let commitReturned = false;
      try {
        git(
          ["commit", "-m", `chore(mode): stage ${validation.value.intent_id} from console`, "--", "harness.json"],
          repo.path
        );
        commitReturned = true;
      } catch {
        const committed = committedHarnessStage(repo.path, harnessPath, next, git, files);
        if (committed) {
          return {
            status: "staged",
            projectId: item.projectId,
            intentId: validation.value.intent_id,
            stagedAt,
            stagedCommitSha: committed,
            idempotent: false
          };
        }
        const restored = restoreHarnessFile(repo.path, harnessPath, original, git, files);
        return failure(item, now, restored ? "git_commit_failed" : "rollback_failed");
      }

      const committed = committedHarnessStage(repo.path, harnessPath, next, git, files);
      if (committed) {
        return {
          status: "staged",
          projectId: item.projectId,
          intentId: validation.value.intent_id,
          stagedAt,
          stagedCommitSha: committed,
          idempotent: false
        };
      }
      if (commitReturned) {
        return {
          status: "ack_pending",
          projectId: item.projectId,
          intentId: validation.value.intent_id,
          stagedAt
        };
      }
      const restored = restoreHarnessFile(repo.path, harnessPath, original, git, files);
      return failure(item, now, restored ? "staged_commit_unverified" : "rollback_failed");
    });
  } catch {
    return failure(item, now, "stage_lock_failed");
  }
}

function readValidatedDefaults(
  repoPath: string,
  now: Date,
  git: GitRunner = runGit
): { payload: HarnessModeIntentPayload; stagedAt: string } | null {
  let parsed: { document: UnknownRecord; project: UnknownRecord } | null;
  try {
    parsed = parseHarnessDocument(readFileSync(join(repoPath, "harness.json"), "utf8"));
  } catch {
    return null;
  }
  if (!parsed) return null;
  const defaults = record(parsed.project.mode_defaults);
  const intent = defaults ? record(defaults.intent) : null;
  if (
    !defaults ||
    !intent ||
    !hasExactKeys(defaults, ["intent", "staged_at"]) ||
    !hasExactKeys(intent, [
      "intent_id",
      "repo_key",
      "expected_head_sha",
      "desired",
      "issued_by",
      "issued_at",
      "intent_expires_at",
      "sig"
    ]) ||
    typeof intent.sig !== "string" ||
    typeof defaults.staged_at !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(defaults.staged_at)
  ) {
    return null;
  }
  const signed = intent as HarnessSignedModeIntent;
  if (!verifySignedModeIntent(repoPath, signed)) return null;
  const { sig: _sig, ...payload } = signed;
  const registry = readRegistryModeContext(repoPath);
  const validation = validateHarnessModeIntentPayload(payload, { now, ...registry });
  if (validation.ok === false || Date.parse(validation.value.issued_at) > now.getTime()) return null;
  try {
    const currentRepoKey = normalizeHarnessRepoKey(git(["remote", "get-url", "origin"], repoPath));
    if (normalizeHarnessRepoKey(validation.value.repo_key) !== currentRepoKey) return null;
  } catch {
    return null;
  }
  return { payload: validation.value, stagedAt: defaults.staged_at };
}

function consumedModeIntentId(repoPath: string): string | null {
  try {
    const progress = record(JSON.parse(readFileSync(join(repoPath, "progress.json"), "utf8")));
    return boundedString(record(progress?.mode_intent)?.intent_id, 128);
  } catch {
    return null;
  }
}

export function readPendingModeDefaults(repoPath: string, now: Date = new Date()): PendingModeDefaultsSummary | null {
  const defaults = readValidatedDefaults(repoPath, now);
  if (!defaults) return null;
  // The framework retains the signed intent as an audit record after /plan
  // consumes it. It must not continue to appear as a next-plan default.
  if (consumedModeIntentId(repoPath) === defaults.payload.intent_id) return null;
  const execution = defaults.payload.desired.execution;
  const autonomy = defaults.payload.desired.autonomy;
  return {
    intentId: defaults.payload.intent_id,
    stagedAt: defaults.stagedAt,
    intentExpiresAt: defaults.payload.intent_expires_at,
    execution: {
      profile: execution.profile,
      roleAssignments: "role_assignments" in execution && execution.role_assignments
        ? { generator: execution.role_assignments.generator, evaluator: execution.role_assignments.evaluator }
        : null,
      roleBindings: "role_bindings" in execution && execution.role_bindings
        ? {
            planner: execution.role_bindings.planner,
            generator: execution.role_bindings.generator,
            evaluator: execution.role_bindings.evaluator
          }
        : null
    },
    autonomy: {
      enabled: autonomy.enabled,
      expiresAt: autonomy.enabled ? autonomy.expires_at : null
    }
  };
}

export function readModeDefaultsReportSummary(
  repoPath: string,
  now: Date = new Date(),
  git: GitRunner = runGit
): ModeDefaultsReportSummary | null {
  const defaults = readValidatedDefaults(repoPath, now, git);
  if (!defaults) return null;
  try {
    const commit = checkedFullSha(git(["log", "-1", "--format=%H", "--", "harness.json"], repoPath));
    if (!commit) return null;
    return { intentId: defaults.payload.intent_id, stagedAt: defaults.stagedAt, stagedCommitSha: commit };
  } catch {
    return null;
  }
}
