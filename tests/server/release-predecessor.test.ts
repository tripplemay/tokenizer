import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

let dir: string;
let baseline: string;
let candidate: string;
function git(...args: string[]) {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function select(overrides: Record<string, string> = {}) {
  return spawnSync("bash", [resolve("scripts/select-release-predecessor.sh")], {
    cwd: dir, encoding: "utf8", env: { ...process.env, REVISION: candidate,
      PREVIOUS_HINT: "", BOOTSTRAP_REHEARSAL: "false", RELEASE_EVENT: "workflow_dispatch", ...overrides }
  });
}
describe.skipIf(process.platform === "win32")("deterministic release predecessor", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "release-predecessor-"));
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "test");
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "baseline");
    baseline = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", baseline);
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "candidate");
    candidate = git("rev-parse", "HEAD");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("uses fetched origin/main for a non-main workflow_dispatch without event predecessor", () => {
    expect(select().status).toBe(0);
    expect(select().stdout.trim()).toBe(baseline);
  });
  it("uses the explicit PR base/push-before SHA when available", () => {
    expect(select({ PREVIOUS_HINT: baseline }).stdout.trim()).toBe(baseline);
  });
  it("refuses same candidate unless an explicit non-deploying bootstrap was chosen", () => {
    git("update-ref", "refs/remotes/origin/main", candidate);
    expect(select().status).toBe(1);
    expect(select({ BOOTSTRAP_REHEARSAL: "true" }).status).toBe(0);
    expect(select({ BOOTSTRAP_REHEARSAL: "true", RELEASE_EVENT: "push" }).status).toBe(1);
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    expect(workflow).toContain("&& inputs.bootstrap_rehearsal != true");
  });
  it("does not silently replace malformed or nonexistent explicit predecessors", () => {
    expect(select({ PREVIOUS_HINT: "not-a-sha" }).status).not.toBe(0);
    expect(select({ PREVIOUS_HINT: "f".repeat(40) }).status).not.toBe(0);
  });
  it("uses origin/main for the zero before SHA and fails if the fetched ref is absent", () => {
    expect(select({ PREVIOUS_HINT: "0".repeat(40) }).stdout.trim()).toBe(baseline);
    git("update-ref", "-d", "refs/remotes/origin/main");
    expect(select().status).not.toBe(0);
  });
});
