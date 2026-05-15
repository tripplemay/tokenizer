import { NextRequest } from "next/server";

export function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.APP_API_KEY;
  if (!expected) return false;
  const provided = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return provided === expected;
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
