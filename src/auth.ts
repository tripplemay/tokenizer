import NextAuth, { type DefaultSession } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/server/db";

// Build-time fallback so `next build` doesn't crash when AUTH_SECRET hasn't
// been wired into the deploy env yet. The placeholder is harmless because
// auth.ts is only imported by routes — Auth.js refuses to mint or accept
// real sessions without a real secret, so production MUST set AUTH_SECRET
// in the deploy env before the login flow becomes functional.
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = "dev-placeholder-set-AUTH_SECRET-in-production";
}

// Auth.js v5 root config. The framework hands us:
//   * handlers — mounted at /api/auth/[...nextauth]/route.ts
//   * auth()    — server-side helper to read the current session inside
//                 server components, server actions, and route handlers
//   * signIn / signOut — programmatic helpers (used by /login etc.)
//
// Phase 1b ships the wiring but does NOT yet require login on existing
// routes — that lands in 1c–1e. Once AUTH_RESEND_KEY is set in the server
// env, magic-link email starts working immediately.

// Module augmentation so `session.user.id` / `session.user.role` typecheck.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
  }
}

const resendKey = process.env.AUTH_RESEND_KEY;
const emailFrom = process.env.AUTH_EMAIL_FROM ?? "no-reply@token.vpanel.cc";

const providers = [];
if (resendKey) {
  providers.push(
    Resend({
      apiKey: resendKey,
      from: emailFrom
    })
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers,
  // DB-backed sessions (rather than JWT). Cookie holds only the session id;
  // every request server-side resolves the real session row, which means
  // logout / revocation is instant and there's no stale JWT problem.
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/verify"
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user as { role?: string }).role ?? "user";
      return session;
    }
  }
});
