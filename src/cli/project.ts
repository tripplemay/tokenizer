import { existsSync } from "node:fs";
import { dirname, basename } from "node:path";

export function inferProjectName(workspacePath?: string | null): string | null {
  if (!workspacePath) return null;
  return basename(workspacePath.replace(/\/+$/, "")) || null;
}

export function findWorkspaceFromPath(pathValue: string | null | undefined, projectRoots: string[]): string | null {
  if (!pathValue) return null;
  let current = pathValue;
  while (current && current !== dirname(current)) {
    if (existsSync(`${current}/.git`)) return current;
    if (projectRoots.some((root) => current === root || dirname(current) === root)) return current;
    current = dirname(current);
  }
  return pathValue;
}
