import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(prefix: "enroll" | "dtok") {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenPrefix(token: string) {
  return token.slice(0, 16);
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
