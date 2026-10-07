import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let dir: string;
function verify() {
  return spawnSync(process.execPath, ["scripts/verify-standalone.mjs", dir], { encoding: "utf8" });
}
describe("standalone runtime artifact boundary", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "standalone-boundary-"));
    mkdirSync(join(dir, "prisma", "migrations", "20260901130000_device_agent_release_version"), { recursive: true });
    writeFileSync(join(dir, "server.js"), "// synthetic standalone server\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts runtime dependencies and explicitly included migration markers", () => {
    expect(verify().status).toBe(0);
  });

  it.each(["CLAUDE.md", "progress.json", "features.json", "docs", "src", ".auto-memory", "private-key.pem", ".env.local"])("rejects unrelated %s from whole-project tracing", (name) => {
    writeFileSync(join(dir, name), "must-not-ship");
    const result = verify();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unrelated standalone artifact");
  });

  it("fails when deployment cannot read migration markers", () => {
    rmSync(join(dir, "prisma"), { recursive: true });
    expect(verify().status).toBe(1);
  });

  it("allows exactly the two imported runtime catalogs traced by Next 15", () => {
    mkdirSync(join(dir, "src", "shared"), { recursive: true });
    mkdirSync(join(dir, "framework", "harness"), { recursive: true });
    writeFileSync(join(dir, "src", "shared", "agent-releases.json"), "{}");
    writeFileSync(join(dir, "framework", "harness", "framework-releases.json"), "{}");
    expect(verify().status).toBe(0);
  });

  it("rejects unrelated source files beside an allowed runtime catalog", () => {
    mkdirSync(join(dir, "src", "shared"), { recursive: true });
    writeFileSync(join(dir, "src", "shared", "agent-releases.json"), "{}");
    writeFileSync(join(dir, "src", "shared", "unrelated.ts"), "must-not-ship");
    expect(verify().status).toBe(1);
  });

  it("checks the actual standalone in the Docker build and explicitly copies Prisma at runtime", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("RUN node scripts/verify-standalone.mjs");
    expect(dockerfile).toContain("COPY --chown=node:node --from=builder /app/prisma ./prisma");
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    expect(workflow.match(/file: \.baseline\/Dockerfile/g)).toHaveLength(2);
  });

  it("gives deploy's independent signed-provenance verifier attestation read access", () => {
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    const deploySection = workflow.slice(workflow.indexOf("\n  deploy:"));
    const permissionBlock = deploySection.match(/\n    permissions:([\s\S]*?)\n    needs:/)?.[1] ?? "";
    const hasRequiredPermissions = (value: string) => ["contents", "packages", "attestations"].every((name) => new RegExp(`\\b${name}: read\\b`).test(value));
    expect(hasRequiredPermissions(permissionBlock)).toBe(true);
    expect(hasRequiredPermissions(permissionBlock.replace("attestations: read", ""))).toBe(false);
    expect(workflow).toContain('--source-digest "$wrong_source"');
    expect(workflow).toContain('/.github/workflows/not-release.yml');
  });
});
