export const AUTH_SECRET_BUILD_PHASE = "phase-production-build";
export const AUTH_SECRET_DEVELOPMENT_PLACEHOLDER =
  "dev-placeholder-set-AUTH_SECRET-in-production";
export const AUTH_SECRET_MIN_LENGTH = 32;

interface AuthSecretEnvironment {
  AUTH_SECRET?: string;
  NEXT_PHASE?: string;
  NODE_ENV?: string;
}

const AUTH_SECRET_ERROR =
  `AUTH_SECRET must be configured with at least ${AUTH_SECRET_MIN_LENGTH} characters for production runtime`;

export function resolveAuthSecret(
  environment: AuthSecretEnvironment = process.env
): string {
  const secret = environment.AUTH_SECRET;
  const normalizedSecret = secret?.trim() ?? "";
  const isProductionRuntime =
    environment.NODE_ENV === "production" &&
    environment.NEXT_PHASE !== AUTH_SECRET_BUILD_PHASE;

  if (
    isProductionRuntime &&
    (normalizedSecret.length < AUTH_SECRET_MIN_LENGTH ||
      normalizedSecret === AUTH_SECRET_DEVELOPMENT_PLACEHOLDER)
  ) {
    throw new Error(AUTH_SECRET_ERROR);
  }

  return normalizedSecret ? secret! : AUTH_SECRET_DEVELOPMENT_PLACEHOLDER;
}
