import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CodexAuth = {
  authMode?: string;
  tokens?: {
    accessToken?: string;
    accountId?: string;
  };
  accountId?: string;
};

// Read-only access to ~/.codex/auth.json. Codex CLI manages this file's
// lifecycle (login, refresh); we never write to it. Returns null on any
// error — missing file, invalid JSON, permission denied — so callers can
// treat "no Codex" uniformly.
//
// snake_case in the file is mapped to camelCase here so consumers don't
// have to deal with Go-style field names.
export function readCodexAuthFile(): CodexAuth | null {
  try {
    const path = join(homedir(), ".codex", "auth.json");
    const raw = readFileSync(path, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    const tokens = json.tokens as Record<string, unknown> | undefined;
    return {
      authMode: typeof json.auth_mode === "string" ? json.auth_mode : undefined,
      tokens: tokens
        ? {
            accessToken: typeof tokens.access_token === "string" ? tokens.access_token : undefined,
            accountId: typeof tokens.account_id === "string" ? tokens.account_id : undefined,
          }
        : undefined,
      accountId: typeof json.account_id === "string" ? json.account_id : undefined,
    };
  } catch {
    return null;
  }
}
