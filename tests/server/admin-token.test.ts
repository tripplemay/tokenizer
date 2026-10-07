import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as adminLogin } from "../../app/api/admin/login/route";
import { isAdminAuthorized } from "@/server/auth";
import {
  ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER,
  ADMIN_TOKEN_MIN_LENGTH,
  resolveAdminToken
} from "@/server/admin-token";

const validToken = "a-production-admin-token-with-at-least-32-characters";

afterEach(() => vi.unstubAllEnvs());

describe("legacy admin token", () => {
  it.each([
    undefined,
    "",
    ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER,
    "a".repeat(ADMIN_TOKEN_MIN_LENGTH - 1),
    ` ${validToken}`
  ])("rejects missing and weak configured values", (token) => {
    expect(resolveAdminToken({ ADMIN_TOKEN: token })).toBeNull();
  });

  it("accepts a configured token without changing its bytes", () => {
    expect(resolveAdminToken({ ADMIN_TOKEN: validToken })).toBe(validToken);
  });

  it("fails closed for the old Compose placeholder on header, cookie and login", async () => {
    vi.stubEnv("ADMIN_TOKEN", ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER);
    const headerRequest = new NextRequest("http://localhost/api/admin/cleanup-claude-legacy", {
      headers: { "x-admin-token": ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER }
    });
    const cookieRequest = new NextRequest("http://localhost/api/admin/cleanup-claude-legacy", {
      headers: { cookie: `admin_token=${ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER}` }
    });

    expect(isAdminAuthorized(headerRequest)).toBe(false);
    expect(isAdminAuthorized(cookieRequest)).toBe(false);

    const loginRequest = new NextRequest("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER })
    });
    expect((await adminLogin(loginRequest)).status).toBe(401);
  });

  it("accepts a strong token via the legacy header", () => {
    vi.stubEnv("ADMIN_TOKEN", validToken);
    const request = new NextRequest("http://localhost/api/admin/cleanup-claude-legacy", {
      headers: { "x-admin-token": validToken }
    });
    expect(isAdminAuthorized(request)).toBe(true);
  });
});
