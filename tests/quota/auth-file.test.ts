import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fakeHome: string;
let restoreHome: () => void;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "tokenizer-auth-"));
  // os.homedir() prefers USERPROFILE on Windows and HOME elsewhere, so both
  // have to be redirected for the fake home to take effect on either OS.
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  restoreHome = () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  };
  vi.resetModules();
});

afterEach(() => {
  restoreHome();
  rmSync(fakeHome, { recursive: true, force: true });
});

function writeCodexAuth(content: string) {
  const dir = join(fakeHome, ".codex");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "auth.json"), content);
}

describe("readCodexAuthFile", () => {
  it("returns null when ~/.codex/auth.json does not exist", async () => {
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    expect(readCodexAuthFile()).toBeNull();
  });

  it("returns null when the file contents are not valid JSON", async () => {
    writeCodexAuth("not-json");
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    expect(readCodexAuthFile()).toBeNull();
  });

  it("maps snake_case fields from the file to camelCase", async () => {
    writeCodexAuth(JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: "sk-token-xyz",
        account_id: "acct_123",
      },
      account_id: "acct_456",
    }));
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    const auth = readCodexAuthFile();
    expect(auth).not.toBeNull();
    expect(auth?.authMode).toBe("chatgpt");
    expect(auth?.tokens?.accessToken).toBe("sk-token-xyz");
    expect(auth?.tokens?.accountId).toBe("acct_123");
    expect(auth?.accountId).toBe("acct_456");
  });

  it("returns null tokens.accessToken when the file lacks tokens entirely", async () => {
    writeCodexAuth(JSON.stringify({ auth_mode: "apikey" }));
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    const auth = readCodexAuthFile();
    expect(auth?.tokens?.accessToken).toBeUndefined();
  });
});
