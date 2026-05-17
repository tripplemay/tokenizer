"use client";

import { SessionProvider } from "next-auth/react";

// Wraps the app so client-side useSession() can read the auth state. We
// don't pass an initial session down — the server already gated the page
// via requireSession(), and SessionProvider will fetch /api/auth/session
// itself on first mount.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
