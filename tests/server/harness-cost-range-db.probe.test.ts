/**
 * Real-Postgres probe for BL-SECURITY-P1 F007.
 *
 *   EVAL_F007_DB_URL=postgresql://... DATABASE_URL=$EVAL_F007_DB_URL \
 *     npx vitest run tests/server/harness-cost-range-db.probe.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { BatchCost, TransitionLike } from "@/server/harness-cost";
import { estimateCost, MODEL_PRICES } from "@/shared/model-pricing";

const DB_URL = process.env.EVAL_F007_DB_URL;
const describeDb = DB_URL ? describe : describe.skip;

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

describeDb("F007 single-query range join (real Postgres)", () => {
  const userId = "f007-user";
  const deviceId = "f007-device";
  const projectId = "f007-project";
  const auditProjectId = "f007-audit-project";
  let prisma: PrismaClient;
  let getBatchCost: (
    userId: string,
    link: { projectId: string | null; repoKey: string | null },
    transitions: TransitionLike[],
    nowMs: number
  ) => Promise<BatchCost | null>;

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== DB_URL) {
      throw new Error("DATABASE_URL must exactly match EVAL_F007_DB_URL for the scratch probe");
    }
    ({ prisma } = await import("@/server/db"));
    ({ getBatchCost } = await import("@/server/harness-cost"));

    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({ data: { id: userId, email: "f007-probe@example.test" } });
    await prisma.device.create({ data: { id: deviceId, userId, name: "F007 probe" } });
    await prisma.project.create({
      data: { id: projectId, userId, name: "F007 project", repoKey: "github.com/example/f007" }
    });
    await prisma.project.create({
      data: { id: auditProjectId, userId, name: "F004 audit replay", repoKey: "github.com/audit/tokenizer-f004" }
    });
    await prisma.usageEvent.createMany({
      data: [
        ["before", "2026-08-10T09:59:59.999Z", 800],
        ["start", "2026-08-10T10:00:00.000Z", 100],
        ["boundary", "2026-08-10T11:00:00.000Z", 200],
        ["inside", "2026-08-10T11:30:00.000Z", 300],
        ["final-end", "2026-08-10T12:00:00.000Z", 400]
      ].map(([sourceEventId, occurredAt, outputTokens]) => ({
        userId,
        deviceId,
        projectId,
        source: "codex",
        sourceEventId: String(sourceEventId),
        model: "claude-fable-5",
        inputTokens: 0,
        outputTokens: Number(outputTokens),
        totalTokens: Number(outputTokens),
        occurredAt: new Date(String(occurredAt))
      }))
    });
    await prisma.usageEvent.createMany({
      data: [
        ["E1", "2026-08-09T18:35:00.000Z", "claude-fable-5", 200_000, 150_000, 20_000, 5_000],
        ["E2", "2026-08-09T18:43:00.000Z", "claude-fable-5", 900_000, 700_000, 100_000, 40_000],
        ["E3", "2026-08-09T18:48:00.000Z", "claude-fable-5", 600_000, 480_000, 60_000, 25_000],
        ["E4", "2026-08-09T18:55:00.000Z", "claude-fable-5", 500_000, 400_000, 50_000, 20_000],
        ["E5", "2026-08-09T19:10:00.000Z", "claude-fable-5", 300_000, 240_000, 30_000, 12_000],
        ["E6", "2026-08-09T19:25:00.000Z", "claude-fable-5", 250_000, 200_000, 25_000, 8_000],
        ["E7", "2026-08-09T19:40:00.000Z", "claude-fable-5", 100_000, 80_000, 10_000, 2_000],
        ["B1", "2026-08-09T18:50:34.000Z", "claude-fable-5", 0, 0, 0, 777],
        ["B2", "2026-08-09T18:30:00.000Z", "claude-fable-5", 0, 0, 0, 333],
        ["B3", "2026-08-09T20:00:00.000Z", "claude-fable-5", 0, 0, 0, 999],
        ["O1", "2026-08-09T18:05:00.000Z", "claude-fable-5", 400_000, 300_000, 40_000, 15_000],
        ["O2", "2026-08-09T18:25:00.000Z", "claude-fable-5", 0, 0, 0, 100],
        ["M1", "2026-08-09T18:57:00.000Z", "gpt-5.3-codex", 1_000_000, 0, 0, 100_000],
        ["M2", "2026-08-09T19:15:00.000Z", "claude-fable-5", 150_000, 0, 0, 10_000]
      ].map(([key, occurredAt, model, inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens]) => ({
        userId,
        deviceId,
        projectId: auditProjectId,
        source: "audit",
        sourceEventId: `audit-${String(key)}`,
        model: String(model),
        inputTokens: Number(inputTokens),
        cachedInputTokens: Number(cachedInputTokens),
        cacheWriteTokens: Number(cacheWriteTokens),
        outputTokens: Number(outputTokens),
        totalTokens: Number(inputTokens) + Number(outputTokens),
        occurredAt: new Date(String(occurredAt))
      }))
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("matches the locked fixture and performs exactly one usage aggregation query", async () => {
    const transitions: TransitionLike[] = [
      {
        fromStatus: "building",
        toStatus: "verifying",
        toBatch: "BL-F007",
        batchBoundary: false,
        fixRounds: 0,
        observedAt: new Date("2026-08-10T11:00:00.000Z")
      },
      {
        fromStatus: null,
        toStatus: "building",
        toBatch: "BL-F007",
        batchBoundary: false,
        fixRounds: 0,
        observedAt: new Date("2026-08-10T10:00:00.000Z")
      },
      {
        fromStatus: "verifying",
        toStatus: "fixing",
        toBatch: "BL-F007",
        batchBoundary: false,
        fixRounds: 1,
        observedAt: new Date("2026-08-10T11:00:00.000Z")
      }
    ];
    const rawSpy = vi.spyOn(prisma, "$queryRaw");
    const result = await getBatchCost(
      userId,
      { projectId, repoKey: "github.com/example/ignored" },
      transitions,
      new Date("2026-08-10T12:00:00.000Z").getTime()
    );

    const buildingCost = estimateCost(
      "claude-fable-5",
      { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
      MODEL_PRICES
    )!;
    const fixingCost = estimateCost(
      "claude-fable-5",
      { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 500 },
      MODEL_PRICES
    )!;

    expect(rawSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({
      batch: "BL-F007",
      totalCostUsd: buildingCost + fixingCost,
      totalComputeTokens: 600,
      phases: [
        {
          phase: "building",
          batch: "BL-F007",
          fixRounds: 0,
          startIso: "2026-08-10T10:00:00.000Z",
          endIso: "2026-08-10T11:00:00.000Z",
          openEnded: false,
          durationMs: 3_600_000,
          computeTokens: 100,
          costUsd: buildingCost,
          unpricedComputeTokens: 0
        },
        {
          phase: "verifying",
          batch: "BL-F007",
          fixRounds: 0,
          startIso: "2026-08-10T11:00:00.000Z",
          endIso: "2026-08-10T11:00:00.000Z",
          openEnded: false,
          durationMs: 0,
          computeTokens: 0,
          costUsd: 0,
          unpricedComputeTokens: 0
        },
        {
          phase: "fixing",
          batch: "BL-F007",
          fixRounds: 1,
          startIso: "2026-08-10T11:00:00.000Z",
          endIso: "2026-08-10T12:00:00.000Z",
          openEnded: true,
          durationMs: 3_600_000,
          computeTokens: 500,
          costUsd: fixingCost,
          unpricedComputeTokens: 0
        }
      ],
      reworkCostUsd: fixingCost,
      reworkComputeTokens: 500,
      hasUnpricedUsage: false,
      unpricedComputeTokens: 0,
      windowStartIso: "2026-08-10T10:00:00.000Z",
      windowEndIso: "2026-08-10T12:00:00.000Z"
    });
    rawSpy.mockRestore();
  });

  it("replays the BL-COST-BATCH-V1 F004 audit fixture without attribution drift", async () => {
    const transitions: TransitionLike[] = [
      [null, "building", "BL-AUDIT-V0", false, 0, "2026-08-09T18:00:00.000Z"],
      ["building", "done", "BL-AUDIT-V0", false, 0, "2026-08-09T18:20:00.000Z"],
      ["done", "planning", "BL-AUDIT-V1", true, 0, "2026-08-09T18:30:00.000Z"],
      ["planning", "building", "BL-AUDIT-V1", false, 0, "2026-08-09T18:41:32.000Z"],
      ["building", "verifying", "BL-AUDIT-V1", false, 0, "2026-08-09T18:50:34.000Z"],
      ["verifying", "fixing", "BL-AUDIT-V1", false, 1, "2026-08-09T19:08:19.000Z"],
      ["fixing", "reverifying", "BL-AUDIT-V1", false, 1, "2026-08-09T19:20:00.000Z"],
      ["reverifying", "done", "BL-AUDIT-V1", false, 1, "2026-08-09T19:30:00.000Z"]
    ].map(([fromStatus, toStatus, toBatch, batchBoundary, fixRounds, observedAt]) => ({
      fromStatus: fromStatus as string | null,
      toStatus: String(toStatus),
      toBatch: String(toBatch),
      batchBoundary: Boolean(batchBoundary),
      fixRounds: Number(fixRounds),
      observedAt: new Date(String(observedAt))
    }));
    const rawSpy = vi.spyOn(prisma, "$queryRaw");

    const result = await getBatchCost(
      userId,
      { projectId: auditProjectId, repoKey: null },
      transitions,
      new Date("2026-08-09T20:00:00.000Z").getTime()
    );

    expect(rawSpy).toHaveBeenCalledOnce();
    expect(result!.phases.map((phase) => [phase.phase, phase.computeTokens])).toEqual([
      ["planning", 55_333],
      ["building", 385_000],
      ["verifying", 1_220_777],
      ["fixing", 232_000],
      ["reverifying", 58_000],
      ["done", 0]
    ]);
    expect(result!.totalComputeTokens).toBe(1_951_110);
    expect(result!.totalCostUsd).toBeCloseTo(19.388, 8);
    expect(result!.reworkComputeTokens).toBe(290_000);
    expect(result!.reworkCostUsd).toBeCloseTo(4.6775, 8);
    expect(result!.windowStartIso).toBe("2026-08-09T18:30:00.000Z");
    expect(result!.windowEndIso).toBe("2026-08-09T19:30:00.000Z");
    expect(result!.hasUnpricedUsage).toBe(false);
    rawSpy.mockRestore();
  });
});
