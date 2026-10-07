import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const permissions = vi.hoisted(() => ({ restrict: vi.fn() }));
vi.mock("@/cli/file-permissions", () => ({ restrictToCurrentUser: permissions.restrict }));
import { writeFileAtomic } from "@/cli/atomic-file";

const roots: string[] = [];
afterEach(() => {
  permissions.restrict.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("restricts the empty atomic temp file before private bytes are written", () => {
  const root = mkdtempSync(join(tmpdir(), "b07-private-creation-")); roots.push(root);
  const path = join(root, "queue.jsonl");
  permissions.restrict.mockImplementation((temp: string) => {
    expect(readFileSync(temp).length).toBe(0);
    return { ok: true, method: "chmod" };
  });
  writeFileAtomic(path, "private canary", { mode: 0o600, restrictToOwner: true });
  expect(permissions.restrict).toHaveBeenCalledOnce();
  expect(readFileSync(path, "utf8")).toBe("private canary");
});

it("failed restriction retains the original file and removes only its own empty temp", () => {
  const root = mkdtempSync(join(tmpdir(), "b07-private-creation-")); roots.push(root);
  const path = join(root, "queue.jsonl");
  writeFileSync(path, "retained");
  permissions.restrict.mockImplementation((temp: string) => {
    expect(readFileSync(temp).length).toBe(0);
    return { ok: false, method: "icacls", error: "synthetic ACL failure" };
  });
  expect(() => writeFileAtomic(path, "private canary", { mode: 0o600, restrictToOwner: true }))
    .toThrow("synthetic ACL failure");
  expect(readFileSync(path, "utf8")).toBe("retained");
  expect(readdirSync(root)).toEqual(["queue.jsonl"]);
});
