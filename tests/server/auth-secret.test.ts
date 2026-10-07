import { describe, expect, it } from "vitest";
import {
  AUTH_SECRET_BUILD_PHASE,
  AUTH_SECRET_DEVELOPMENT_PLACEHOLDER,
  AUTH_SECRET_MIN_LENGTH,
  resolveAuthSecret,
  resolveResendKey
} from "@/server/auth-secret";

describe("resolveAuthSecret", () => {
  it("uses the placeholder during a production build without a secret", () => {
    expect(
      resolveAuthSecret({
        NODE_ENV: "production",
        NEXT_PHASE: AUTH_SECRET_BUILD_PHASE
      })
    ).toBe(AUTH_SECRET_DEVELOPMENT_PLACEHOLDER);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
    ["historical placeholder", AUTH_SECRET_DEVELOPMENT_PLACEHOLDER],
    ["too short", "short-secret-value"]
  ])("rejects a %s secret in production runtime without disclosing it", (_, secret) => {
    let thrown: unknown;

    try {
      resolveAuthSecret({ NODE_ENV: "production", AUTH_SECRET: secret });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("AUTH_SECRET");
    expect(message).toContain(String(AUTH_SECRET_MIN_LENGTH));
    if (secret) expect(message).not.toContain(secret);
  });

  it("keeps the placeholder available in development", () => {
    expect(resolveAuthSecret({ NODE_ENV: "development" })).toBe(
      AUTH_SECRET_DEVELOPMENT_PLACEHOLDER
    );
  });

  it("preserves a valid production secret", () => {
    const secret = "a-production-secret-with-at-least-32-characters";

    expect(resolveAuthSecret({ NODE_ENV: "production", AUTH_SECRET: secret })).toBe(
      secret
    );
  });
});

describe("resolveResendKey", () => {
  it("allows a missing key while building or developing", () => {
    expect(resolveResendKey({ NODE_ENV: "production", NEXT_PHASE: AUTH_SECRET_BUILD_PHASE })).toBeNull();
    expect(resolveResendKey({ NODE_ENV: "development" })).toBeNull();
  });

  it.each([undefined, "", "   "])("rejects a missing production key without echoing it", (key) => {
    expect(() => resolveResendKey({ NODE_ENV: "production", AUTH_RESEND_KEY: key })).toThrow(
      "AUTH_RESEND_KEY must be configured"
    );
  });

  it("preserves a configured production key", () => {
    expect(resolveResendKey({ NODE_ENV: "production", AUTH_RESEND_KEY: "re_configured" })).toBe(
      "re_configured"
    );
  });
});
