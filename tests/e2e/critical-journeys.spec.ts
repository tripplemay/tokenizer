import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.use({ locale: "zh-CN" });

const baseURL = process.env.CI_E2E_BASE_URL ?? "http://127.0.0.1:3781";
const fixtureId = `ci_e2e_${randomUUID().replace(/-/g, "")}`;
const freshUserId = `${fixtureId}_fresh`;
const historicalUserId = `${fixtureId}_historical`;
const historicalDeviceId = `${fixtureId}_device`;
const freshSession = `ci-e2e-${randomBytes(32).toString("hex")}`;
const historicalSession = `ci-e2e-${randomBytes(32).toString("hex")}`;
const prisma = new PrismaClient();
const browserErrors = new WeakMap<Page, string[]>();

function assertScratchDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (process.env.CI_E2E !== "1" || !raw || raw !== process.env.E2E_DATABASE_URL) {
    throw new Error("CI_E2E=1 and matching DATABASE_URL/E2E_DATABASE_URL are required");
  }
  const url = new URL(raw);
  if (
    url.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^tokenizer_e2e(?:_|$)/.test(url.pathname.slice(1))
  ) {
    throw new Error("Refusing to seed a non-local or non-E2E PostgreSQL database");
  }
}

async function authenticate(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([{ name: "authjs.session-token", value: token, url: baseURL }]);
}

test.beforeAll(async () => {
  assertScratchDatabase();
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 60 * 1000);
  await prisma.user.create({
    data: {
      id: freshUserId,
      email: `${freshUserId}@example.invalid`,
      emailVerified: now,
      timezone: "UTC",
      sessions: { create: { sessionToken: freshSession, expires } }
    }
  });
  await prisma.user.create({
    data: {
      id: historicalUserId,
      email: `${historicalUserId}@example.invalid`,
      emailVerified: now,
      timezone: "UTC",
      sessions: { create: { sessionToken: historicalSession, expires } }
    }
  });
  await prisma.device.create({
    data: { id: historicalDeviceId, userId: historicalUserId, name: "CI historical device", platform: "linux" }
  });
  await prisma.usageEvent.create({
    data: {
      userId: historicalUserId,
      deviceId: historicalDeviceId,
      source: "codex",
      sourceEventId: `${fixtureId}_old_event`,
      model: "gpt-5.4",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      occurredAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000)
    }
  });
});

test.afterAll(async () => {
  if (process.env.CI_E2E === "1") {
    await prisma.user.deleteMany({ where: { id: { in: [freshUserId, historicalUserId] } } });
  }
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach("browser-errors", {
      body: Buffer.from((browserErrors.get(page) ?? []).join("\n")),
      contentType: "text/plain"
    });
  }
});

test("anonymous visitor is redirected to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: /登录|Sign in/i })).toBeVisible();
});

test("historical tenant keeps range controls and can return to all-time events", async ({ context, page }) => {
  await authenticate(context, historicalSession);
  await page.goto("/?range=7d");
  await expect(page.getByRole("heading", { name: "所选时间范围内暂无用量" })).toBeVisible();
  await expect(page.getByRole("link", { name: "全部", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "全部", exact: true }).click();
  await expect(page.getByText("事件总数", { exact: true })).toBeVisible();
  await page.goto("/events");
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody tr")).toContainText("CI historical device");
});

test("first enroll and upload reaches the dashboard without a manual reload", async ({ context, page }) => {
  await authenticate(context, freshSession);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /欢迎使用 Tokenizer/ })).toBeVisible();

  const generated = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/enrollment-tokens") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "生成安装命令" }).click();
  const tokenResponse = await generated;
  expect(tokenResponse.status()).toBe(200);
  const { enrollToken } = await tokenResponse.json() as { enrollToken: string };
  expect(enrollToken).toMatch(/^enroll_/);

  const deviceId = `${fixtureId}_first_device`;
  const enrolled = await context.request.post(`${baseURL}/api/devices/enroll`, {
    data: {
      enrollToken,
      device: { id: deviceId, name: "CI first device", platform: "linux" }
    }
  });
  expect(enrolled.status()).toBe(200);
  const { deviceToken } = await enrolled.json() as { deviceToken: string };
  await expect(page.getByText("已连接:CI first device", { exact: true })).toBeVisible({ timeout: 20_000 });

  const uploaded = await context.request.post(`${baseURL}/api/usage/events/batch`, {
    headers: { authorization: `Bearer ${deviceToken}` },
    data: {
      device: { id: deviceId, name: "CI first device", platform: "linux" },
      events: [{
        source: "codex",
        sourceEventId: `${fixtureId}_first_event`,
        model: "gpt-5.4",
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        occurredAt: new Date().toISOString()
      }],
      timezone: "UTC"
    }
  });
  expect(uploaded.status()).toBe(200);
  expect((await uploaded.json()).inserted).toBe(1);

  await expect(page.getByText("事件总数", { exact: true })).toBeVisible({ timeout: 125_000 });
  await expect(page.getByRole("heading", { name: /欢迎使用 Tokenizer/ })).toHaveCount(0);
});
