import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, isAbsolute, parse } from "node:path";
import type { BigIntStats } from "node:fs";
import { parseClaudeJsonlBuffer } from "@/parsers/claude";
import type { UsageEventInput } from "@/shared/usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";
import { enrichEventsWithGit } from "./git";
import { mergeQueue } from "./collect";
import { readConfig, type TokenizerConfig } from "./config";
import { collectionAdmissionFingerprint, collectionScopeFingerprint, effectivePrivacy, filterUsageEvents, type PrivacyConfig } from "./privacy";
import type { BoundedReplayPlan } from "./replay-contract";

const MAX_PHYSICAL_RECORDS = 50_000;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_ELAPSED_MS = 10_000;
export const MAX_REPLAY_SAMPLE = 5;

type FileIdentity = Readonly<{
  dev: string;
  ino: string;
  size: number;
  mtimeNs: string;
  ctimeNs: string;
  contentSha256: string;
}>;

export type ReplayFileSnapshot = Readonly<{
  bytes: Buffer;
  mtime: Date;
  records: number;
  identity: FileIdentity;
}>;

export type ReplayReadHooks = {
  afterPathStat?: () => void;
  afterRead?: () => void;
};

type ReplayInspection = {
  snapshot: ReplayFileSnapshot;
  planDigest: string;
  parsed: number;
  selected: UsageEventInput[];
  eligible: UsageEventInput[];
  warningCount: number;
  scopeFingerprint: string;
  mode: "sync" | "local-only" | "paused";
  admissionBinding: string;
};

export type ReplayDryRunResult = {
  dryRun: true;
  planDigest: string;
  bytes: number;
  records: number;
  parsed: number;
  selected: number;
  filtered: number;
  wouldAdmit: number;
  warningCount: number;
  sample: Array<{
    occurredAt: string;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
};

export type ReplayExecutionResult = {
  dryRun: false;
  planDigest: string;
  selected: number;
  filtered: number;
  admitted: number;
  duplicates: number;
  backlog: number;
  warningCount: number;
  upload: string;
};

function fail(message: string): never {
  throw new Error(`Replay refused: ${message}`);
}

function replayDeadline(): number {
  return Date.now() + MAX_ELAPSED_MS;
}

function assertWithinDeadline(deadlineMs: number, stage: string): void {
  if (Date.now() >= deadlineMs) fail(`${stage} exceeded ${MAX_ELAPSED_MS}ms deadline`);
}

function enrichReplayEvents(events: UsageEventInput[], deadlineMs: number): UsageEventInput[] {
  try {
    return enrichEventsWithGit(events, { deadlineMs });
  } catch (error) {
    if (error instanceof Error && /deadline|timeout/i.test(error.message)) {
      fail(`Git enrichment exceeded ${MAX_ELAPSED_MS}ms deadline`);
    }
    fail("Git enrichment could not complete safely");
  }
}

function statIdentity(stat: BigIntStats): Omit<FileIdentity, "contentSha256"> {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: Number(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs)
  };
}

function sameIdentity(left: Omit<FileIdentity, "contentSha256">, right: Omit<FileIdentity, "contentSha256">): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

type ParentIdentity = { path: string; dev: string; ino: string };

function checkSourcePath(file: string, deadlineMs: number, nativeAttributes = true): ParentIdentity[] {
  assertWithinDeadline(deadlineMs, "source inspection");
  const segments = file.split(process.platform === "win32" ? /[\\/]/ : /\//);
  if (!isAbsolute(file) || segments.some((segment) => segment === "." || segment === "..")) {
    fail("source requires an absolute path without dot traversal");
  }
  if (process.platform === "win32" && (!/^[a-z]:[\\/]/i.test(file) || file.slice(3).includes(":"))) {
    fail("source requires a local Windows drive file, not a device, network path or alternate stream");
  }
  const parents: string[] = [];
  for (let current = dirname(file); ; current = dirname(current)) {
    parents.unshift(current);
    if (current === parse(current).root) break;
  }
  const identities = parents.map((path) => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("source parent must be a non-symlink directory");
    return { path, dev: String(stat.dev), ino: String(stat.ino) };
  });
  if (process.platform === "win32") {
    const leaf = lstatSync(file, { bigint: true });
    if (!leaf.isFile() || leaf.isSymbolicLink()) fail("source must be one regular non-symlink file");
  }
  if (process.platform === "win32" && nativeAttributes) {
    // Node's stat flags do not expose every Windows reparse tag. Check native
    // attributes before/after reading; unavailable checks fail closed.
    const script = "$ErrorActionPreference='Stop'; foreach($p in (ConvertFrom-Json $env:TOKENIZER_REPLAY_PATHS)) { if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' } }; 'TOKENIZER_REPLAY_NO_REPARSE_V1'";
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) fail(`read exceeded ${MAX_ELAPSED_MS}ms`);
    const result = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, TOKENIZER_REPLAY_PATHS: JSON.stringify([...parents, file]) },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      timeout: remaining, maxBuffer: 16 * 1024
    });
    if (result.trim() !== "TOKENIZER_REPLAY_NO_REPARSE_V1") fail("source reparse-point check failed");
  }
  assertWithinDeadline(deadlineMs, "source inspection");
  return identities;
}

function checkSameParents(before: ParentIdentity[], after: ParentIdentity[]) {
  if (before.length !== after.length || before.some((parent, index) => {
    const current = after[index];
    return parent.path !== current.path || parent.dev !== current.dev || parent.ino !== current.ino;
  })) fail("source parent changed while being read");
}

function validateRecords(bytes: Buffer): number {
  let records = 0;
  let lineStart = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    if (index - lineStart > MAX_LINE_BYTES) fail(`line exceeds ${MAX_LINE_BYTES} bytes`);
    records += 1;
    if (records > MAX_PHYSICAL_RECORDS) fail(`physical record limit exceeds ${MAX_PHYSICAL_RECORDS}`);
    lineStart = index + 1;
  }
  if (lineStart < bytes.length) {
    if (bytes.length - lineStart > MAX_LINE_BYTES) fail(`line exceeds ${MAX_LINE_BYTES} bytes`);
    records += 1;
  }
  if (records > MAX_PHYSICAL_RECORDS) fail(`physical record limit exceeds ${MAX_PHYSICAL_RECORDS}`);
  return records;
}

export function readBoundedReplayFile(
  file: string,
  maxBytes: number,
  hooks: ReplayReadHooks = {},
  deadlineMs = replayDeadline()
): ReplayFileSnapshot {
  let descriptor: number | undefined;
  try {
    const parents = checkSourcePath(file, deadlineMs);
    const beforeStat = lstatSync(file, { bigint: true });
    if (!beforeStat.isFile() || beforeStat.isSymbolicLink()) fail("source must be one regular non-symlink file");
    const before = statIdentity(beforeStat);
    if (before.size > maxBytes) fail(`byte limit exceeded (${before.size} > ${maxBytes})`);
    hooks.afterPathStat?.();
    assertWithinDeadline(deadlineMs, "source inspection");
    checkSameParents(parents, checkSourcePath(file, deadlineMs, false));

    // O_NOFOLLOW alone still blocks when a regular path is raced into a FIFO.
    const flags = process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
    descriptor = openSync(file, constants.O_RDONLY | flags);
    const openedStat = fstatSync(descriptor, { bigint: true });
    if (!openedStat.isFile()) fail("opened source is not a regular file");
    const opened = statIdentity(openedStat);
    if (!sameIdentity(before, opened)) fail("source changed between path check and open");
    checkSameParents(parents, checkSourcePath(file, deadlineMs, false));

    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
      assertWithinDeadline(deadlineMs, "read");
    }
    if (offset > maxBytes) fail(`byte limit exceeded (${offset} > ${maxBytes})`);
    hooks.afterRead?.();

    assertWithinDeadline(deadlineMs, "read");
    checkSameParents(parents, checkSourcePath(file, deadlineMs));

    const afterHandleStat = fstatSync(descriptor, { bigint: true });
    const afterPathStat = lstatSync(file, { bigint: true });
    if (!afterPathStat.isFile() || afterPathStat.isSymbolicLink()) fail("source path became non-regular");
    const afterHandle = statIdentity(afterHandleStat);
    const afterPath = statIdentity(afterPathStat);
    if (!sameIdentity(opened, afterHandle) || !sameIdentity(opened, afterPath)) fail("source changed while being read");
    assertWithinDeadline(deadlineMs, "read");

    const content = bytes.subarray(0, offset);
    return Object.freeze({
      bytes: content,
      mtime: new Date(Number(afterHandleStat.mtimeMs)),
      records: validateRecords(content),
      identity: Object.freeze({ ...afterHandle, contentSha256: createHash("sha256").update(content).digest("hex") })
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Replay refused:")) throw error;
    fail("source could not be opened safely");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function admissionBinding(selected: UsageEventInput[], candidates: UsageEventInput[], privacy: PrivacyConfig): string {
  return createHash("sha256").update(JSON.stringify({
    physicalScope: collectionAdmissionFingerprint(selected, privacy),
    candidates
  })).digest("hex");
}

function digestPlan(plan: BoundedReplayPlan, identity: FileIdentity, config: TokenizerConfig, binding: string): string {
  const privacy = effectivePrivacy(config);
  return createHash("sha256").update(JSON.stringify({
    schema: "bounded-replay-confirmation-v1",
    source: plan.source,
    file: plan.file,
    from: plan.from,
    to: plan.to,
    maxBytes: plan.maxBytes,
    maxEvents: plan.maxEvents,
    maxFiles: plan.maxFiles,
    identity,
    projectRoots: config.projectRoots,
    admissionBinding: binding,
    collectionScopeFingerprint: collectionScopeFingerprint(privacy),
    privacyMode: privacy.mode
  })).digest("hex");
}

function inspectReplay(plan: BoundedReplayPlan, config: TokenizerConfig, deadlineMs: number): ReplayInspection {
  assertWithinDeadline(deadlineMs, "inspection");
  const privacy = effectivePrivacy(config);
  const snapshot = readBoundedReplayFile(plan.file, plan.maxBytes, {}, deadlineMs);
  const parsed = parseClaudeJsonlBuffer({
    file: plan.file,
    bytes: snapshot.bytes,
    mtime: snapshot.mtime,
    projectRoots: config.projectRoots
  });
  const from = Date.parse(plan.from);
  const to = Date.parse(plan.to);
  const selected = parsed.events.filter((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    return Number.isFinite(occurredAt) && occurredAt >= from && occurredAt < to;
  });
  if (selected.length > plan.maxEvents) fail(`event limit exceeded (${selected.length} > ${plan.maxEvents})`);
  assertWithinDeadline(deadlineMs, "parse and scope admission");
  const eligible = filterUsageEvents(
    enrichReplayEvents(filterUsageEvents(selected, privacy), deadlineMs),
    privacy
  ).map(minimizeUsageEvent);
  assertWithinDeadline(deadlineMs, "Git enrichment and scope admission");
  const binding = admissionBinding(selected, eligible, privacy);
  assertWithinDeadline(deadlineMs, "inspection");
  return {
    snapshot,
    planDigest: digestPlan(plan, snapshot.identity, config, binding),
    parsed: parsed.events.length,
    selected,
    eligible,
    warningCount: parsed.warnings.length,
    scopeFingerprint: collectionScopeFingerprint(privacy),
    mode: privacy.mode,
    admissionBinding: binding
  };
}

function safeSample(events: UsageEventInput[], count: number): ReplayDryRunResult["sample"] {
  return events.slice(0, count).map((event) => ({
    occurredAt: event.occurredAt,
    model: event.model ?? null,
    inputTokens: event.inputTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    totalTokens: event.totalTokens ?? 0
  }));
}

export function dryRunBoundedReplay(plan: BoundedReplayPlan, config: TokenizerConfig, sampleCount = 0): ReplayDryRunResult {
  if (!plan.dryRun) fail("execution plan cannot be used as a dry-run");
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || sampleCount > MAX_REPLAY_SAMPLE) {
    fail(`sample limit must be between 0 and ${MAX_REPLAY_SAMPLE}`);
  }
  const inspection = inspectReplay(plan, config, replayDeadline());
  return {
    dryRun: true,
    planDigest: inspection.planDigest,
    bytes: inspection.snapshot.bytes.length,
    records: inspection.snapshot.records,
    parsed: inspection.parsed,
    selected: inspection.selected.length,
    filtered: inspection.selected.length - inspection.eligible.length,
    wouldAdmit: inspection.eligible.length,
    warningCount: inspection.warningCount,
    sample: safeSample(inspection.eligible, sampleCount)
  };
}

export function executeBoundedReplay(
  plan: BoundedReplayPlan,
  config: TokenizerConfig,
  confirmation: string,
  options: {
    readCurrentConfig?: () => TokenizerConfig;
    mergeEvents?: typeof mergeQueue;
  } = {}
): ReplayExecutionResult {
  if (plan.dryRun) fail("dry-run plan cannot execute");
  if (!/^[0-9a-f]{64}$/.test(confirmation)) fail("execution requires an exact lowercase SHA-256 confirmation digest");
  if (effectivePrivacy(config).mode === "paused") fail("execution is disabled while privacy mode is paused");
  const deadlineMs = replayDeadline();
  const inspection = inspectReplay(plan, config, deadlineMs);
  if (inspection.planDigest !== confirmation) fail("confirmation digest does not match the current file, scope, mode, window, or budgets");

  // Re-open immediately before admission. A file replacement/growth or a
  // configure change after the preview invalidates the confirmation rather
  // than admitting a different snapshot.
  const currentConfig = (options.readCurrentConfig ?? readConfig)();
  assertWithinDeadline(deadlineMs, "final config admission");
  const confirmationSnapshot = readBoundedReplayFile(plan.file, plan.maxBytes, {}, deadlineMs);
  if (digestPlan(plan, confirmationSnapshot.identity, currentConfig, inspection.admissionBinding) !== confirmation) {
    fail("confirmation digest became stale before queue admission");
  }
  if (inspection.scopeFingerprint !== collectionScopeFingerprint(effectivePrivacy(currentConfig)) ||
      inspection.mode !== effectivePrivacy(currentConfig).mode) {
    fail("privacy scope or mode changed before queue admission");
  }

  const privacy = effectivePrivacy(currentConfig);
  const admittedCandidates = filterUsageEvents(
    enrichReplayEvents(filterUsageEvents(inspection.selected, privacy), deadlineMs),
    privacy
  ).map(minimizeUsageEvent);
  assertWithinDeadline(deadlineMs, "final Git enrichment and admission");
  const finalBinding = admissionBinding(inspection.selected, admittedCandidates, privacy);
  if (digestPlan(plan, confirmationSnapshot.identity, currentConfig, finalBinding) !== confirmation) {
    fail("physical scope or admitted candidates became stale before queue admission");
  }
  assertWithinDeadline(deadlineMs, "queue admission");
  const remainingMs = Math.max(1, deadlineMs - Date.now());
  const merged = options.mergeEvents
    ? options.mergeEvents(admittedCandidates)
    : mergeQueue(admittedCandidates, undefined, {
      timeoutMs: remainingMs,
      beforeMutate: () => assertWithinDeadline(deadlineMs, "queue admission")
    });
  return {
    dryRun: false,
    planDigest: confirmation,
    selected: inspection.selected.length,
    filtered: inspection.selected.length - inspection.eligible.length,
    admitted: merged.added,
    duplicates: admittedCandidates.length - merged.added,
    backlog: merged.events.length,
    warningCount: inspection.warningCount,
    upload: inspection.mode === "sync"
      ? "Backlog uploads automatically on the next Agent/run/sync cycle."
      : "Backlog remains local until sync mode; it then uploads on the next Agent/run/sync cycle."
  };
}
