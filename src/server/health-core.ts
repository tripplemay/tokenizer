import { AUTH_SECRET_DEVELOPMENT_PLACEHOLDER, AUTH_SECRET_MIN_LENGTH } from "@/server/auth-secret";
import { signingKeyReady } from "@/server/harness-sign";

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function deployedCommit(env: NodeJS.ProcessEnv = process.env): string {
  return /^[a-f0-9]{40}$/i.test(env.GIT_COMMIT ?? "") ? env.GIT_COMMIT! : "unknown";
}

export function healthCapabilities(env: NodeJS.ProcessEnv = process.env, signingReady = signingKeyReady()) {
  const secret = env.AUTH_SECRET?.trim() ?? "";
  const authSession = secret.length >= AUTH_SECRET_MIN_LENGTH && secret !== AUTH_SECRET_DEVELOPMENT_PLACEHOLDER;
  const admin = (env.ADMIN_TOKEN?.trim().length ?? 0) >= 32 && env.ADMIN_TOKEN?.trim() !== "change-me";
  const email = configured(env.AUTH_RESEND_KEY) && configured(env.AUTH_EMAIL_FROM);
  return {
    authSession,
    admin,
    email,
    harnessGateSigning: signingReady ? "ready" as const : "read_only" as const
  };
}
