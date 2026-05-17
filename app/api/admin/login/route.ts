import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/server/auth";
import { safeEqual } from "@/server/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !body.token || !safeEqual(body.token, expected)) {
    return Response.json({ error: "invalid admin token" }, { status: 401 });
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE, body.token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24
  });
  return Response.json({ ok: true });
}
