import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { isAdminAuthorized } from "./auth";

// Route-level admin gate for the pricing admin API. Accepts EITHER a logged-in
// session whose user.role is "admin" (the direction the codebase is migrating
// toward — cf. enrollment-tokens moving onto session auth) OR the legacy
// ADMIN_TOKEN header/cookie (so an operator or an out-of-band script can drive
// the scan without a browser session). Returns the acting user id when known.
export async function authorizeAdminRequest(
  request: NextRequest
): Promise<{ ok: true; userId: string | null } | { ok: false }> {
  const session = await auth();
  if (session?.user?.role === "admin") {
    return { ok: true, userId: session.user.id };
  }
  if (isAdminAuthorized(request)) {
    return { ok: true, userId: null };
  }
  return { ok: false };
}
