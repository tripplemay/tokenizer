import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const databaseURL = process.env.DATABASE_URL;
const baseURL = process.env.CI_E2E_BASE_URL;
const authSecret = process.env.AUTH_SECRET;

if (
  process.env.CI_E2E !== "1" ||
  !databaseURL ||
  databaseURL !== process.env.E2E_DATABASE_URL ||
  !baseURL ||
  !authSecret
) {
  throw new Error("CI_E2E=1, matching scratch database URLs, CI_E2E_BASE_URL and AUTH_SECRET are required");
}

const database = new URL(databaseURL);
const app = new URL(baseURL);
if (
  database.protocol !== "postgresql:" ||
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !/^tokenizer_e2e(?:_|$)/.test(database.pathname.slice(1)) ||
  app.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(app.hostname)
) {
  throw new Error("Refusing a non-local app or non-E2E PostgreSQL database");
}

const prisma = new PrismaClient();
const marker = randomUUID().replaceAll("-", "");
const email = `b02_magic_${marker}@example.invalid`;
const rawToken = randomBytes(32).toString("hex");
const token = createHash("sha256").update(`${rawToken}${authSecret}`).digest("hex");

try {
  await prisma.verificationToken.create({
    data: { identifier: email, token, expires: new Date(Date.now() + 60_000) }
  });

  const callback = new URL("/api/auth/callback/resend", app);
  callback.searchParams.set("callbackUrl", "/events");
  callback.searchParams.set("token", rawToken);
  callback.searchParams.set("email", email);

  const response = await fetch(callback, { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location"), app).pathname, "/events");

  const setCookie = response.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie.match(/(?:^|,\s*)(authjs\.session-token=[^;]+)/)?.[1];
  assert.ok(sessionCookie, "magic-link callback must issue a database session cookie");

  const sessionResponse = await fetch(new URL("/api/auth/session", app), {
    headers: { cookie: sessionCookie }
  });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.equal(session.user.email, email);
  const createdUser = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(session.user.id, createdUser.id);
  assert.equal(await prisma.verificationToken.count({ where: { identifier: email } }), 0);

  const replay = await fetch(callback, { redirect: "manual" });
  assert.equal(replay.status, 302);
  assert.match(replay.headers.get("location") ?? "", /error=Verification/);
  console.log("Next 16/Auth.js magic-link callback, session issuance and one-time token replay PASS");
} finally {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  await prisma.$disconnect();
}
