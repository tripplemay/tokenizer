import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DEFAULT_TENANT_ID } from "./auth";

// Multi-tenant abstraction. In Phase 1 (where tenant === user), this returns
// the logged-in user's id. Pages and queries thread the resolved tenantId
// into every data fetch and into unstable_cache keys so cached results
// never cross tenants.
//
// During the 1c rollout some pages haven't yet been hardened to require
// auth (that lands in 1d). When no session is present, we fall back to the
// seeded owner so the existing single-tenant install keeps working for
// the operator. Once 1d ships, callers will use requireSession() instead,
// which redirects unauthenticated visitors to /login.

export async function getCurrentTenantId(): Promise<string> {
  const session = await auth();
  return session?.user?.id ?? DEFAULT_TENANT_ID;
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session;
}

// Useful when a page is "auth optional" — show a friendlier message instead
// of redirecting, e.g. for landing or marketing surfaces.
export async function getSessionOrNull() {
  return auth();
}
