export const ADMIN_TOKEN_MIN_LENGTH = 32;
export const ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER = "change-me";

interface AdminTokenEnvironment {
  ADMIN_TOKEN?: string;
  [key: string]: string | undefined;
}

export function resolveAdminToken(
  environment: AdminTokenEnvironment = process.env
): string | null {
  const token = environment.ADMIN_TOKEN;
  if (
    !token ||
    token.length < ADMIN_TOKEN_MIN_LENGTH ||
    token.trim() !== token ||
    token === ADMIN_TOKEN_DEVELOPMENT_PLACEHOLDER
  ) {
    return null;
  }
  return token;
}
