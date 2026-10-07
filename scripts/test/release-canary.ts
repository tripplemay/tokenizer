import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

// Synthetic identity only. Never print bearer tokens, cookies, or response bodies.
const prisma = new PrismaClient();
const base = process.env.CANARY_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost|tokenizer-rehearsal-[0-9]+-[0-9]+-app):[0-9]+$/.test(base)) {
  throw new Error("CANARY_URL must name an isolated HTTP rehearsal service");
}
const id = `release-canary-${randomUUID()}`;
const enrollToken = randomUUID();
const sessionToken = randomUUID();
async function request(path: string, init?: RequestInit) {
  const result = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!result.ok) throw new Error(`canary ${path} returned ${result.status}`);
  return result.json();
}
async function main() {
  try {
    await prisma.user.create({ data: { id, email: `${id}@example.test` } });
    await prisma.session.create({ data: { userId: id, sessionToken, expires: new Date(Date.now() + 600_000) } });
    await prisma.enrollmentToken.create({ data: {
      userId: id, tokenHash: createHash("sha256").update(enrollToken).digest("hex"),
      prefix: enrollToken.slice(0, 12), expiresAt: new Date(Date.now() + 600_000)
    } });
    const device = { id, name: "release-canary", platform: "linux" };
    const enrolled = await request("/api/devices/enroll", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollToken, device })
    });
    if (typeof enrolled.deviceToken !== "string") throw new Error("canary enrollment omitted device token");
    await request("/api/usage/events/batch", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${enrolled.deviceToken}` },
      body: JSON.stringify({ device, timezone: "UTC", events: [{
        source: "aider", sourceEventId: id, projectName: id, model: "release-canary",
        inputTokens: 17, outputTokens: 6, totalTokens: 23, costUsd: 0.125,
        occurredAt: new Date().toISOString()
      }] })
    });
    const result = await request("/api/summary", { headers: { cookie: `authjs.session-token=${sessionToken}` } });
    if (result.summary?.totalTokens !== 23 || result.summary?.eventCount !== 1) {
      throw new Error("canary summary did not match the synthetic event");
    }
    const rows = await prisma.usageEvent.count({ where: { userId: id, sourceEventId: id } });
    if (rows !== 1) throw new Error("canary ingest row count mismatch");
    console.log(JSON.stringify({ stage: "enroll-ingest-summary", ok: true, eventCount: 1, totalTokens: 23 }));
  } finally {
    try {
      if (process.env.CANARY_KEEP !== "1") await prisma.user.deleteMany({ where: { id } });
    } finally {
      await prisma.$disconnect();
    }
  }
}
main().catch(() => { console.error("release business canary failed (details withheld)"); process.exitCode = 1; });
