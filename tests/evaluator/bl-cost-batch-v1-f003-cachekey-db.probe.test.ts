/**
 * EVALUATOR PROBE (BL-COST-BATCH-V1 F003) — real-Prisma cache-key identity check.
 *
 * The render probe (bl-cost-batch-v1-f003-projects-card.test.ts) proves the two
 * pages construct byte-identical getBatchCost arguments *for fixture rows whose
 * key order we authored*. The one assumption left unverified there is that the
 * real Prisma client returns transition objects with keys in select-literal
 * order for BOTH pages' different select shapes — if it did not, the projects
 * page (which passes raw Prisma rows) and the harness page (which maps to a
 * literal) would serialize differently, split the unstable_cache key, and drop
 * the mechanical same-value guarantee down to "same deterministic computation".
 *
 * This probe runs the two pages' actual queries against a scratch postgres and
 * byte-compares the serialized argument tuples, then feeds both through the
 * real aggregation (no mocks except next/cache identity) and asserts deep-equal
 * results with hand-computed sums.
 *
 * Gated: requires EVAL_F003_DB_URL (scratch DB with prisma migrate deploy run).
 * Skipped everywhere else (CI, plain `npm run test`).
 *
 *   docker run -d --name tokenizer-eval-f003-pg -p 55440:5432 \
 *     -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=scratch postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:pg@localhost:55440/scratch npx prisma migrate deploy
 *   EVAL_F003_DB_URL=postgresql://postgres:pg@localhost:55440/scratch \
 *   DATABASE_URL=$EVAL_F003_DB_URL npx vitest run tests/evaluator/bl-cost-batch-v1-f003-cachekey-db.probe.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ownedHarnessProjectDetailQuery } from "../../src/server/harness-detail";
import { MODEL_PRICES, estimateCost } from "../../src/shared/model-pricing";

// Identity-mock the cache wrapper only: outside a Next request scope
// unstable_cache has no incremental cache to talk to. Everything else is real.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => undefined
}));

const DB_URL = process.env.EVAL_F003_DB_URL;

const USER_ID = "user-f003-probe";
const DEVICE_ID = "device-f003-probe";
const PROJECT_ID = "proj-f003-probe";
const HP_ID = "hp-f003-probe";
const REPO_KEY = "github.com/acme/tokenizer-probe";
const BATCH = "BL-COST-BATCH-V1";
const MODEL = Object.keys(MODEL_PRICES)[0]; // seed-priced so costUsd is nonzero

const T0 = new Date("2026-08-10T10:00:00.000Z"); // first observation -> building
const T1 = new Date("2026-08-10T11:00:00.000Z"); // building -> verifying
const NOW_MS = new Date("2026-08-10T12:00:00.000Z").getTime(); // 30s multiple

describe.skipIf(!DB_URL)("probe: F003 cache-key identity across both pages (real Prisma, scratch DB)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    // idempotent re-runs
    await db.user.deleteMany({ where: { id: USER_ID } });
    await db.user.create({ data: { id: USER_ID, email: "f003-probe@example.test" } });
    await db.device.create({ data: { id: DEVICE_ID, userId: USER_ID, name: "probe" } });
    await db.project.create({
      data: { id: PROJECT_ID, userId: USER_ID, name: "tokenizer-probe", repoKey: REPO_KEY }
    });
    await db.harnessProject.create({
      data: {
        id: HP_ID,
        userId: USER_ID,
        deviceId: DEVICE_ID,
        repoKey: REPO_KEY,
        name: "tokenizer-probe",
        projectId: PROJECT_ID,
        status: "verifying",
        batch: BATCH
      }
    });
    await db.harnessTransition.createMany({
      data: [
        {
          userId: USER_ID,
          harnessProjectId: HP_ID,
          fromStatus: null,
          toStatus: "building",
          toBatch: BATCH,
          observedAt: T0
        },
        {
          userId: USER_ID,
          harnessProjectId: HP_ID,
          fromStatus: "building",
          toStatus: "verifying",
          fromBatch: BATCH,
          toBatch: BATCH,
          observedAt: T1
        }
      ]
    });
    await db.usageEvent.createMany({
      data: [
        {
          userId: USER_ID,
          deviceId: DEVICE_ID,
          source: "claude-code",
          sourceEventId: "f003-e1",
          projectId: PROJECT_ID,
          model: MODEL,
          inputTokens: 1_000_000,
          cachedInputTokens: 400_000,
          cacheWriteTokens: 100_000,
          outputTokens: 50_000,
          occurredAt: new Date("2026-08-10T10:30:00.000Z") // building window
        },
        {
          userId: USER_ID,
          deviceId: DEVICE_ID,
          source: "claude-code",
          sourceEventId: "f003-e2",
          projectId: PROJECT_ID,
          model: MODEL,
          inputTokens: 200_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 10_000,
          occurredAt: new Date("2026-08-10T11:30:00.000Z") // verifying window
        },
        {
          userId: USER_ID,
          deviceId: DEVICE_ID,
          source: "claude-code",
          sourceEventId: "f003-e3",
          projectId: PROJECT_ID,
          model: MODEL,
          inputTokens: 999_999,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 999_999,
          occurredAt: new Date("2026-08-10T09:59:59.999Z") // before the window: must be excluded
        }
      ]
    });
  });

  afterAll(async () => {
    if (db) {
      await db.user.deleteMany({ where: { id: USER_ID } }); // cascades
      await db.$disconnect();
    }
  });

  it("both pages' queries serialize into byte-identical getBatchCost argument tuples", async () => {
    // --- app/projects/[id]/page.tsx query, verbatim select shape ---
    const harnessProjects = await db.harnessProject.findMany({
      where: { projectId: PROJECT_ID, userId: USER_ID },
      select: {
        id: true,
        name: true,
        batch: true,
        status: true,
        repoKey: true,
        transitions: {
          where: { userId: USER_ID },
          orderBy: { observedAt: "desc" as const },
          take: 100,
          select: {
            fromStatus: true,
            toStatus: true,
            toBatch: true,
            batchBoundary: true,
            fixRounds: true,
            observedAt: true
          }
        }
      }
    });
    expect(harnessProjects).toHaveLength(1);
    const hp = harnessProjects[0];

    // real-Prisma key order must match the select literal (and the harness
    // page's map literal) — this is the assumption the render probe cannot test
    expect(Object.keys(hp.transitions[0])).toEqual([
      "fromStatus",
      "toStatus",
      "toBatch",
      "batchBoundary",
      "fixRounds",
      "observedAt"
    ]);

    // --- app/harness/[id]/page.tsx query + map, verbatim ---
    const detail = await db.harnessProject.findFirst(ownedHarnessProjectDetailQuery(HP_ID, USER_ID));
    expect(detail).not.toBeNull();

    const projectsPageArgs = [
      USER_ID,
      { projectId: PROJECT_ID, repoKey: hp.repoKey },
      hp.transitions,
      NOW_MS
    ];
    const harnessPageArgs = [
      USER_ID,
      { projectId: detail!.project?.id ?? null, repoKey: detail!.repoKey },
      detail!.transitions.map((row) => ({
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        toBatch: row.toBatch,
        batchBoundary: row.batchBoundary,
        fixRounds: row.fixRounds,
        observedAt: row.observedAt
      })),
      NOW_MS
    ];

    // JSON.stringify(args) is the per-invocation discriminator in the
    // unstable_cache key: byte equality = same key = one shared cached value.
    expect(JSON.stringify(projectsPageArgs)).toBe(JSON.stringify(harnessPageArgs));
  });

  it("the shared export computes deep-equal, hand-checkable values for both pages' inputs", async () => {
    // real harness-cost against the scratch DB: point the db singleton there
    process.env.DATABASE_URL = DB_URL;
    const { getBatchCost } = await import("../../src/server/harness-cost");

    const hp = (
      await db.harnessProject.findMany({
        where: { projectId: PROJECT_ID, userId: USER_ID },
        select: {
          repoKey: true,
          transitions: {
            where: { userId: USER_ID },
            orderBy: { observedAt: "desc" as const },
            take: 100,
            select: {
              fromStatus: true,
              toStatus: true,
              toBatch: true,
              batchBoundary: true,
              fixRounds: true,
              observedAt: true
            }
          }
        }
      })
    )[0];
    const detail = await db.harnessProject.findFirst(ownedHarnessProjectDetailQuery(HP_ID, USER_ID));

    const fromProjectsPage = await getBatchCost(
      USER_ID,
      { projectId: PROJECT_ID, repoKey: hp.repoKey },
      hp.transitions,
      NOW_MS
    );
    const fromHarnessPage = await getBatchCost(
      USER_ID,
      { projectId: detail!.project?.id ?? null, repoKey: detail!.repoKey },
      detail!.transitions.map((row) => ({
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        toBatch: row.toBatch,
        batchBoundary: row.batchBoundary,
        fixRounds: row.fixRounds,
        observedAt: row.observedAt
      })),
      NOW_MS
    );

    expect(fromProjectsPage).not.toBeNull();
    expect(fromProjectsPage).toEqual(fromHarnessPage);

    // hand-computed: building window carries e1, verifying window carries e2,
    // pre-window e3 is excluded
    const e1 = { inputTokens: 1_000_000, cachedInputTokens: 400_000, cacheWriteTokens: 100_000, outputTokens: 50_000 };
    const e2 = { inputTokens: 200_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10_000 };
    const expectedCost = estimateCost(MODEL, e1, MODEL_PRICES)! + estimateCost(MODEL, e2, MODEL_PRICES)!;
    const expectedCompute = 1_000_000 - 400_000 + 50_000 + (200_000 - 0 + 10_000);

    expect(fromProjectsPage!.totalCostUsd).toBeCloseTo(expectedCost, 8);
    expect(fromProjectsPage!.totalComputeTokens).toBe(expectedCompute);
    expect(fromProjectsPage!.phases.map((p) => p.phase)).toEqual(["building", "verifying"]);
    expect(fromProjectsPage!.batch).toBe(BATCH);
  });
});
