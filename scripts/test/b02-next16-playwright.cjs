const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const databaseURL = process.env.DATABASE_URL;
const baseURL = process.env.CI_E2E_BASE_URL;
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH;
if (
  process.env.CI_E2E !== "1" ||
  !databaseURL ||
  databaseURL !== process.env.E2E_DATABASE_URL ||
  !baseURL ||
  !playwrightPath
) {
  throw new Error("CI_E2E=1, matching scratch database URLs, CI_E2E_BASE_URL and PLAYWRIGHT_MODULE_PATH are required");
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

const { chromium } = require(playwrightPath);
const prisma = new PrismaClient();
const marker = `B02 Browser ${randomUUID()}`;
const userId = `b02_browser_${randomUUID().replaceAll("-", "")}`;
const sessionToken = randomBytes(32).toString("hex");

(async () => {
  let browser;
  try {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        emailVerified: new Date(),
        timezone: "UTC",
        sessions: {
          create: { sessionToken, expires: new Date(Date.now() + 60 * 60 * 1000) }
        }
      }
    });
    await prisma.device.create({
      data: { id: `${userId}_device`, userId, name: marker, platform: "linux" }
    });
    await prisma.usageEvent.create({
      data: {
        userId,
        deviceId: `${userId}_device`,
        source: "codex",
        sourceEventId: `${userId}_event`,
        model: "gpt-5.4",
        inputTokens: 123,
        totalTokens: 123,
        occurredAt: new Date()
      }
    });

    browser = await chromium.launch({ headless: true });
    const anonymous = await browser.newPage();
    await anonymous.goto(new URL("/events", app).href);
    assert.equal(new URL(anonymous.url()).pathname, "/login");

    const context = await browser.newContext();
    await context.addCookies([{
      name: "authjs.session-token",
      value: sessionToken,
      domain: app.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }]);
    const page = await context.newPage();
    await page.goto(new URL("/events", app).href);
    assert.equal(new URL(page.url()).pathname, "/events");
    await page.getByText(marker, { exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
    console.log("Next 16 authenticated Chromium render and anonymous redirect PASS");
  } finally {
    if (browser) await browser.close();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
