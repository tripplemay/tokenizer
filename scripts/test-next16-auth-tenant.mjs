import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const databaseURL = process.env.DATABASE_URL;
const baseURL = process.env.CI_E2E_BASE_URL;
if (process.env.CI_E2E !== "1" || !databaseURL || databaseURL !== process.env.E2E_DATABASE_URL || !baseURL) {
  throw new Error("CI_E2E=1, matching scratch database URLs and CI_E2E_BASE_URL are required");
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
const marker = `b02_${randomUUID().replaceAll("-", "")}`;
const ids = [`${marker}_a`, `${marker}_b`];
const tokens = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];

try {
  for (let index = 0; index < 2; index += 1) {
    await prisma.user.create({
      data: {
        id: ids[index],
        email: `${ids[index]}@example.invalid`,
        emailVerified: new Date(),
        timezone: "UTC",
        sessions: {
          create: { sessionToken: tokens[index], expires: new Date(Date.now() + 60 * 60 * 1000) }
        }
      }
    });
    await prisma.device.create({
      data: { id: `${ids[index]}_device`, userId: ids[index], name: `B02 Device ${index}`, platform: "linux" }
    });
    await prisma.usageEvent.create({
      data: {
        userId: ids[index],
        deviceId: `${ids[index]}_device`,
        source: "codex",
        sourceEventId: `${marker}_event_${index}`,
        model: "gpt-5.4",
        inputTokens: 100 + index,
        totalTokens: 100 + index,
        occurredAt: new Date()
      }
    });
  }

  const login = await fetch(new URL("/login", app));
  assert.equal(login.status, 200);
  const loginHTML = await login.text();
  assert.match(loginHTML, /<html lang="zh-CN">/);
  assert.match(loginHTML, /登录 Tokenizer/);
  const englishLogin = await fetch(new URL("/login", app), { headers: { cookie: "NEXT_LOCALE=en" } });
  assert.equal(englishLogin.status, 200);
  const englishHTML = await englishLogin.text();
  assert.match(englishHTML, /<html lang="en">/);
  assert.match(englishHTML, /Sign in to Tokenizer/);
  const cssPath = loginHTML.match(/href="(\/_next\/static\/chunks\/[^\"]+\.css)"/)?.[1];
  assert.ok(cssPath, "login page must link a built CSS asset");
  assert.equal((await fetch(new URL(cssPath, app))).status, 200);

  const providers = await fetch(new URL("/api/auth/providers", app));
  assert.equal(providers.status, 200);
  assert.deepEqual(Object.keys(await providers.json()), ["resend"]);
  assert.equal((await fetch(new URL("/api/events", app))).status, 401);

  for (let index = 0; index < 2; index += 1) {
    const headers = { cookie: `authjs.session-token=${tokens[index]}` };
    const events = await fetch(new URL("/api/events", app), { headers });
    assert.equal(events.status, 200);
    const eventIds = (await events.json()).events.map((event) => event.sourceEventId);
    assert.ok(eventIds.includes(`${marker}_event_${index}`));
    assert.ok(!eventIds.includes(`${marker}_event_${1 - index}`));

    assert.equal((await fetch(new URL("/api/summary", app), { headers })).status, 200);
    const page = await fetch(new URL("/events", app), { headers });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(`B02 Device ${index}`));
    assert.ok(!html.includes(`B02 Device ${1 - index}`));
    console.log(`tenant ${index}: authenticated events, summary and page isolated`);
  }

  await prisma.session.delete({ where: { sessionToken: tokens[0] } });
  assert.equal((await fetch(new URL("/api/events", app), {
    headers: { cookie: `authjs.session-token=${tokens[0]}` }
  })).status, 401);
  console.log("Next 16/Auth.js/next-intl scratch two-tenant and revocation smoke PASS");
} finally {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
