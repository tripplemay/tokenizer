import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (process.env.B09_REAL_REPLAY !== "1" || !/^postgresql:\/\/[^/]+@127\.0\.0\.1:\d+\/tokenizer_b09_cache$/.test(databaseUrl)) {
  throw new Error("Refusing to run outside an explicitly opted-in local tokenizer_b09_cache database");
}

const prisma = new PrismaClient();
const baseUrl = "http://127.0.0.1:3783";
const adminToken = "b09-real-replay-admin-only";
const deviceToken = "b09-real-replay-device-only";
const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000);
const runId = now.toString(36);
const id = (suffix) => `b09_real_${runId}_${suffix}`;
const cookie = (tenant) => `authjs.session-token=${id(`session_${tenant}`)}`;
const stages = [];

async function seedTenant(tenant) {
  const userId = id(`user_${tenant}`);
  const deviceId = id(`device_${tenant}`);
  const projectId = id(`project_${tenant}`);
  const harnessId = id(`harness_${tenant}`);
  const repoKey = `github.com/synthetic/b09-${tenant}`;
  await prisma.user.create({ data: {
    id: userId, email: `${tenant}@b09-replay.invalid`, role: tenant === "a" ? "admin" : "user",
    sessions: { create: { sessionToken: id(`session_${tenant}`), expires: at(-120) } }
  } });
  await prisma.device.create({ data: { id: deviceId, userId, name: `B09 ${tenant}`, platform: "darwin", agentFeatureVersion: 9 } });
  await prisma.project.create({ data: { id: projectId, userId, name: `B09 ${tenant}`, workspacePath: `/synthetic/b09-${tenant}`, repoKey } });
  await prisma.harnessProject.create({ data: {
    id: harnessId, userId, deviceId, projectId, repoKey, name: `B09 ${tenant} harness`, status: "done", batch: "B09-REAL",
    reportedAt: at(60)
  } });
  await prisma.harnessTransition.createMany({ data: [
    { userId, harnessProjectId: harnessId, fromStatus: null, toStatus: "building", toBatch: "B09-REAL", batchBoundary: true, observedAt: at(120) },
    { userId, harnessProjectId: harnessId, fromStatus: "building", toStatus: "done", fromBatch: "B09-REAL", toBatch: "B09-REAL", observedAt: at(60) }
  ] });
  await prisma.usageEvent.create({ data: {
    id: id(`event_${tenant}_baseline`), userId, deviceId, projectId, repoKey,
    source: "aider", sourceEventId: `baseline-${tenant}`, model: "gpt-5.4",
    inputTokens: 1_000_000, totalTokens: 1_000_000, occurredAt: at(90)
  } });
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Next exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  throw new Error("Next did not become ready");
}

async function assertPages(tenant, expectedCost) {
  for (const path of [`/harness/${id(`harness_${tenant}`)}`, `/projects/${id(`project_${tenant}`)}`]) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: cookie(tenant) }, cache: "no-store" });
    const html = await response.text();
    if (!response.ok || !html.includes(expectedCost)) {
      throw new Error(`${path} status=${response.status}; expected ${expectedCost}; observed ${html.match(/\$\d+(?:\.\d+)?/g)?.slice(0, 12)}`);
    }
    stages.push({ path, expectedCost, status: response.status });
  }
  const summaryResponse = await fetch(`${baseUrl}/api/summary`, { headers: { cookie: cookie(tenant) }, cache: "no-store" });
  const summary = await summaryResponse.json();
  const expected = Number(expectedCost.slice(1));
  const amounts = [summary.summary?.totalCost, summary.projects?.[0]?.cost, summary.devices?.[0]?.cost,
    summary.models?.find((row) => row.name === "gpt-5.4")?.cost];
  if (!summaryResponse.ok || amounts.some((amount) => typeof amount !== "number" || Math.abs(amount - expected) > 0.00001)) {
    throw new Error(`/api/summary status=${summaryResponse.status}; expected ${expected}; observed ${JSON.stringify(amounts)}`);
  }
  stages.push({ path: "/api/summary", tenant, amounts });
}

async function assertPagesEventually(tenant, expectedCost) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await assertPages(tenant, expectedCost);
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      stages.push({ tenant, expectedCost, cacheRevalidationPending: true, attempt: attempt + 1 });
      await sleep(1_000);
    }
  }
}

async function upload(sourceEventId, inputTokens) {
  const response = await fetch(`${baseUrl}/api/usage/events/batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      device: { id: id("device_a"), name: "B09 a", diagnostics: { agentFeatureVersion: 9 } },
      events: [{ source: "aider", sourceEventId, workspacePath: "/synthetic/b09-a", repoKey: "github.com/synthetic/b09-a",
        model: "gpt-5.4", inputTokens, totalTokens: inputTokens, occurredAt: at(90).toISOString() }]
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Usage upload failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function uploadLegacy() {
  const response = await fetch(`${baseUrl}/api/usage/events/batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      device: { id: id("device_a"), name: "B09 a", diagnostics: { agentFeatureVersion: 9 } },
      events: [1_000_000, 2_000_000].map((inputTokens, index) => ({
        source: "claude-code", sourceEventId: `claude:b09-${index}`, sessionId: "b09-legacy-session",
        workspacePath: "/synthetic/b09-a", repoKey: "github.com/synthetic/b09-a",
        model: "gpt-5.4", inputTokens, totalTokens: inputTokens, occurredAt: at(90).toISOString()
      }))
    })
  });
  const body = await response.json();
  if (!response.ok || body.inserted !== 2) throw new Error(`Legacy upload failed: ${response.status} ${JSON.stringify(body)}`);
}

async function uploadFreeModel() {
  const response = await fetch(`${baseUrl}/api/usage/events/batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      device: { id: id("device_a"), name: "B09 a", diagnostics: { agentFeatureVersion: 9 } },
      events: [{ source: "aider", sourceEventId: "auto-free-a", workspacePath: "/synthetic/b09-a",
        repoKey: "github.com/synthetic/b09-a", model: "synthetic-b09-auto-free", inputTokens: 1_000_000,
        totalTokens: 1_000_000, occurredAt: at(90).toISOString() }]
    })
  });
  const body = await response.json();
  if (!response.ok || body.inserted !== 1) throw new Error(`Free-model upload failed: ${response.status} ${JSON.stringify(body)}`);
}

async function assertAutoFree(modelKey) {
  const row = await prisma.modelPrice.findUnique({ where: { modelKey } });
  if (row?.status !== "auto_applied") throw new Error(`Expected ${modelKey} to be auto_applied`);
  const response = await fetch(`${baseUrl}/api/summary`, { headers: { cookie: cookie("a") }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok || data.summary?.unpricedTokens !== 0 || data.models?.find((model) => model.name === modelKey)?.cost !== 0) {
    throw new Error(`Auto-free price not reflected: ${response.status} ${JSON.stringify({ unpricedTokens: data.summary?.unpricedTokens, models: data.models })}`);
  }
  stages.push({ modelKey, autoFree: true, unpricedTokens: 0 });
}

async function scanFreeModel() {
  const modelKey = "synthetic-b09-scan-free";
  await prisma.usageEvent.create({ data: {
    id: id("scan_free"), userId: id("user_a"), deviceId: id("device_a"), projectId: id("project_a"),
    repoKey: "github.com/synthetic/b09-a", source: "aider", sourceEventId: "scan-free-a", model: modelKey,
    inputTokens: 1_000_000, totalTokens: 1_000_000, occurredAt: at(90)
  } });
  const response = await fetch(`${baseUrl}/api/admin/pricing/scan`, {
    method: "POST", headers: { "x-admin-token": adminToken, "content-type": "application/json" },
    body: JSON.stringify({ dryRun: false })
  });
  const body = await response.json();
  if (!response.ok || body.summary?.toAutoFree !== 1) throw new Error(`Free-model scan failed: ${response.status} ${JSON.stringify(body)}`);
  await assertAutoFree(modelKey);
}

async function cleanupLegacy(dryRun) {
  const response = await fetch(`${baseUrl}/api/admin/cleanup-claude-legacy`, {
    method: "POST",
    headers: { "x-admin-token": adminToken, "content-type": "application/json" },
    body: JSON.stringify({ dryRun })
  });
  const body = await response.json();
  if (!response.ok || body.summary.rowsToDelete !== 1 || body.executed === dryRun) {
    throw new Error(`Legacy cleanup failed: ${response.status} ${JSON.stringify(body)}`);
  }
}

async function run() {
  await prisma.user.deleteMany({ where: { id: { startsWith: "b09_real_" } } });
  await prisma.modelPrice.deleteMany({ where: { modelKey: { in: ["gpt-5.4", "synthetic-b09-auto-free", "synthetic-b09-scan-free"] } } });
  await seedTenant("a");
  await seedTenant("b");
  await prisma.deviceToken.create({ data: {
    userId: id("user_a"), deviceId: id("device_a"), prefix: "b09-real",
    tokenHash: createHash("sha256").update(deviceToken).digest("hex")
  } });
  await prisma.modelPrice.create({ data: {
    modelKey: "gpt-5.4", status: "approved", input: 2.5, cacheRead: 0.25, cacheWrite: 2.5, output: 15,
    source: "manual", confidence: "high"
  } });

  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3783"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AUTH_SECRET: "b09-replay-synthetic-secret-at-least-32-chars", AUTH_URL: baseUrl,
      AUTH_TRUST_HOST: "true", NEXT_PUBLIC_APP_URL: baseUrl, ADMIN_TOKEN: adminToken,
      AUTH_RESEND_KEY: "", RESEND_API_KEY: "", PRICING_AUTO_ENABLED: "false", TZ: "UTC" }
  });
  const serverLogs = [];
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => serverLogs.push(String(chunk)));
  try {
    await waitForServer(child);
    await assertPages("a", "$2.50");
    await assertPages("b", "$2.50");

    await uploadFreeModel();
    await assertAutoFree("synthetic-b09-auto-free");
    await assertPages("a", "$2.50");
    await scanFreeModel();
    await assertPages("a", "$2.50");

    const inserted = await upload("late-a", 1_000_000);
    if (inserted.inserted !== 1) throw new Error(`Expected insertion: ${JSON.stringify(inserted)}`);
    await assertPages("a", "$5.00");
    await assertPages("b", "$2.50");

    const corrected = await upload("late-a", 2_000_000);
    if (corrected.updated !== 1) throw new Error(`Expected correction: ${JSON.stringify(corrected)}`);
    await assertPages("a", "$7.50");
    await assertPages("b", "$2.50");

    const priceResponse = await fetch(`${baseUrl}/api/admin/pricing/review`, {
      method: "POST", headers: { "x-admin-token": adminToken, "content-type": "application/json" },
      body: JSON.stringify({ modelKey: "gpt-5.4", action: "edit", price: { input: 5, cacheRead: 0.5, cacheWrite: 5, output: 30 } })
    });
    if (!priceResponse.ok) throw new Error(`Price update failed: ${priceResponse.status} ${await priceResponse.text()}`);
    await assertPages("a", "$15.00");
    await assertPages("b", "$5.00");

    await prisma.usageEvent.delete({ where: { id: id("event_a_baseline") } });
    await sleep(32_000);
    await assertPagesEventually("a", "$10.00");
    await assertPages("b", "$5.00");

    await uploadLegacy();
    await assertPages("a", "$25.00");
    await cleanupLegacy(true);
    await assertPages("a", "$25.00");
    await cleanupLegacy(false);
    await assertPages("a", "$20.00");
    await assertPages("b", "$5.00");

    const denied = await fetch(`${baseUrl}/harness/${id("harness_a")}`, { headers: { cookie: cookie("b") }, redirect: "manual" });
    if (denied.status !== 404) throw new Error(`Cross-tenant harness lookup returned ${denied.status}`);
    console.log(JSON.stringify({ result: "pass", stages, inserted, corrected, crossTenantStatus: denied.status }, null, 2));
  } catch (error) {
    console.error(serverLogs.join("").slice(-8000));
    throw error;
  } finally {
    child.kill("SIGTERM");
    await prisma.$disconnect();
  }
}

await run();
