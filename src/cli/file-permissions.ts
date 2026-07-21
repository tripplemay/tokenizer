// Restricting a local secret file to its owner, per platform.
//
// `fs.chmod(path, 0o600)` is not portable: on Windows it only toggles the
// read-only attribute and grants no ACL restriction at all, so the device
// token stayed readable by every other account on the machine. Windows needs
// icacls to break inheritance and grant the current user alone.

import { chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";

export type RestrictResult = {
  ok: boolean;
  method: "chmod" | "icacls" | "skipped";
  error?: string;
};

function windowsPrincipal(): string | null {
  const user = process.env.USERNAME;
  if (!user) return null;
  // Domain-qualify when we can: a bare username is ambiguous on a machine
  // joined to a domain that has a local account by the same name.
  const domain = process.env.USERDOMAIN;
  return domain ? `${domain}\\${user}` : user;
}

/**
 * Make `path` readable only by the current user.
 *
 * Returns a result rather than throwing: failing to tighten permissions must
 * not stop enrollment from completing, but callers are expected to surface
 * `ok: false` so the weakened state is visible instead of silent.
 */
export function restrictToCurrentUser(path: string, platform: string = process.platform): RestrictResult {
  if (platform !== "win32") {
    try {
      chmodSync(path, 0o600);
      return { ok: true, method: "chmod" };
    } catch (error) {
      return { ok: false, method: "chmod", error: (error as Error).message };
    }
  }

  const principal = windowsPrincipal();
  if (!principal) {
    return { ok: false, method: "skipped", error: "USERNAME is not set; cannot determine the ACL principal" };
  }

  try {
    // /inheritance:r drops ACEs inherited from the parent directory (which
    // typically include Administrators and SYSTEM); /grant:r replaces rather
    // than appends, so the result is exactly one entry.
    execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${principal}:F`], { stdio: "ignore" });
    return { ok: true, method: "icacls" };
  } catch (error) {
    return { ok: false, method: "icacls", error: (error as Error).message };
  }
}
