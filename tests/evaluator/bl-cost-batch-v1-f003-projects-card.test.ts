/**
 * Evaluator-owned probes for BL-COST-BATCH-V1 F003 (projects detail harness-cost
 * linkage card). Written in a fresh context at SHA c27fb38.
 *
 * Renders the real /projects/[id] server component to static markup:
 *  - next-intl is replaced by a resolver over the actual messages/en.json, so any
 *    key referenced by the page but missing from the bundle fails the test;
 *  - the REAL src/server/harness-cost module is used (prisma / next-cache /
 *    model-prices mocked at the same seams as tests/server/harness-cost.test.ts),
 *    with getBatchCost wrapped in a pass-through spy so the page's exact call
 *    arguments can be captured.
 *
 * Asserted acceptance surface (spec §F003):
 *  1. same-caliber-same-value mechanics: the serialized getBatchCost arguments
 *     (JSON.stringify — exactly the discriminator unstable_cache appends to its
 *     key) are byte-identical to what app/harness/[id]/page.tsx builds for the
 *     same underlying transition rows and the same quantized now;
 *  2. no linked harnessProject -> the whole card is absent from the markup;
 *  3. row link href = /harness/{id};
 *  (+) linked project with zero transitions -> card still renders (spec hides it
 *      only when no harnessProject is linked), cost cells fall back to em-dash,
 *      and no usageEvent query is issued.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTokens, formatUsd } from "@/shared/format";
import { estimateCost } from "@/shared/model-pricing";

const mocks = vi.hoisted(() => ({
  prisma: {
    project: { findFirst: vi.fn() },
    harnessProject: { findMany: vi.fn() },
    usageEvent: { groupBy: vi.fn() }
  },
  getProjectDetail: vi.fn(),
  requireSession: vi.fn(),
  getUserTimezone: vi.fn(),
  getEffectivePrices: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/summaries", () => ({ getProjectDetail: mocks.getProjectDetail }));
vi.mock("@/server/auth-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/server/timezone", () => ({ getUserTimezone: mocks.getUserTimezone }));
vi.mock("@/server/model-prices", () => ({ getEffectivePrices: mocks.getEffectivePrices }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
// Widget transitively imports via the bare "components/*" tsconfig path that the
// vitest resolver does not map; the widget row is out of scope for this probe.
vi.mock("@/components/widget/Widget", () => ({ default: () => null }));

// Wrap the real getBatchCost in a pass-through spy: the page must call the
// shared export (not a private aggregation), and we need its exact arguments.
vi.mock("@/server/harness-cost", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/server/harness-cost")>();
  return { ...mod, getBatchCost: vi.fn(mod.getBatchCost) };
});

vi.mock("next-intl/server", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const messages = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "messages", "en.json"), "utf8")
  ) as Record<string, unknown>;

  function resolve(root: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((node, part) => {
      if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
        return (node as Record<string, unknown>)[part];
      }
      return undefined;
    }, root);
  }

  function makeTranslator(namespace?: string) {
    const base = namespace ? resolve(messages, namespace) : messages;
    if (base === undefined) throw new Error(`missing i18n namespace: ${namespace}`);
    const t = (key: string, values?: Record<string, unknown>): string => {
      const raw = resolve(base, key);
      if (typeof raw !== "string") {
        throw new Error(`missing i18n message: ${namespace ?? ""}.${key}`);
      }
      return raw.replace(/\{(\w+)\}/g, (_match, name: string) => String(values?.[name]));
    };
    t.has = (key: string): boolean => typeof resolve(base, key) === "string";
    return t;
  }

  return { getTranslations: async (namespace?: string) => makeTranslator(namespace) };
});

// vitest's esbuild transform compiles the app's JSX with the classic runtime;
// provide the React global before pulling in the server component module.
(globalThis as Record<string, unknown>).React = React;
const { default: ProjectPage } = await import("../../app/projects/[id]/page");
const harnessCost = await import("../../src/server/harness-cost");

const NOW = new Date("2026-08-10T12:00:00.000Z"); // exact 30s multiple
const USER_ID = "user-eval-f003";
const PROJECT_ID = "proj-1";
const REPO_KEY = "github.com/acme/tokenizer";
const BATCH = "BL-COST-BATCH-V1";

// Rows exactly as the projects-page findMany select shapes them
// (key order = select literal order, observedAt desc — mirrors the query).
const PROJECTS_PAGE_TRANSITIONS = [
  {
    fromStatus: "building",
    toStatus: "verifying",
    toBatch: BATCH,
    batchBoundary: false,
    fixRounds: 0,
    observedAt: new Date("2026-08-10T11:00:00.000Z")
  },
  {
    fromStatus: null,
    toStatus: "building",
    toBatch: BATCH,
    batchBoundary: false,
    fixRounds: 0,
    observedAt: new Date("2026-08-10T10:00:00.000Z")
  }
];

// The same logical rows as ownedHarnessProjectDetailQuery would return them for
// the harness detail page (superset of fields, harness-detail select key order).
const DETAIL_PAGE_TRANSITIONS = PROJECTS_PAGE_TRANSITIONS.map((row, index) => ({
  id: `tr-${index}`,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  fromBatch: row.fromStatus === null ? null : BATCH,
  toBatch: row.toBatch,
  batchBoundary: row.batchBoundary,
  fixRounds: row.fixRounds,
  headSha: null,
  observedAfter: null,
  observedAt: row.observedAt
}));

const HP_ROW = {
  id: "hp-1",
  name: "tokenizer",
  batch: BATCH,
  status: "verifying",
  repoKey: REPO_KEY,
  transitions: PROJECTS_PAGE_TRANSITIONS
};

const PRICES = {
  "gpt-5.6-sol": { input: 2, cacheRead: 0.5, cacheWrite: 2.5, output: 8 }
} as never;
const SUMS = {
  inputTokens: 1_000_000,
  cachedInputTokens: 400_000,
  cacheWriteTokens: 100_000,
  outputTokens: 50_000
};

async function renderPage(): Promise<string> {
  const element = await ProjectPage({ params: Promise.resolve({ id: PROJECT_ID }) });
  return renderToStaticMarkup(createElement("div", null, element));
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { id: USER_ID } });
  mocks.getUserTimezone.mockResolvedValue("UTC");
  mocks.prisma.project.findFirst.mockResolvedValue({
    id: PROJECT_ID,
    name: "Tokenizer",
    repoKey: REPO_KEY,
    workspacePath: "/Users/dev/tokenizer"
  });
  mocks.getProjectDetail.mockResolvedValue({
    totals: { _sum: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } },
    events: [],
    bySource: [],
    byModel: [],
    projectCost: 0
  });
  mocks.getEffectivePrices.mockResolvedValue(PRICES);
  mocks.prisma.usageEvent.groupBy.mockResolvedValue([{ model: "gpt-5.6-sol", _sum: SUMS }]);
});

describe("BL-COST-BATCH-V1 F003 projects detail card (real page render, en messages)", () => {
  it("renders the linkage card with batch, status label, cost, and /harness/{id} link", async () => {
    mocks.prisma.harnessProject.findMany.mockResolvedValue([HP_ROW]);
    const markup = await renderPage();

    // card + note (precision wording) present
    expect(markup).toContain("Orchestration batch cost");
    expect(markup).toContain("discloses unpriced/truncation under-count paths");
    // batch cell + status label via harness.status.phase.*
    expect(markup).toContain(BATCH);
    expect(markup).toContain("Verifying");
    // acceptance 3: row link target
    expect(markup).toContain('href="/harness/hp-1"');

    // same caliber as the harness overview card: totals from the shared export
    const perPhase = estimateCost("gpt-5.6-sol", SUMS, PRICES)!;
    expect(markup).toContain(formatUsd(perPhase * 2)); // 2 intervals x same groupBy sums
    expect(markup).toContain(formatTokens((1_000_000 - 400_000 + 50_000) * 2));
  });

  it("passes getBatchCost arguments that serialize byte-identically to the harness page's construction (cache-key identity)", async () => {
    mocks.prisma.harnessProject.findMany.mockResolvedValue([HP_ROW]);
    await renderPage();

    const spy = vi.mocked(harnessCost.getBatchCost);
    expect(spy).toHaveBeenCalledTimes(1);

    // app/harness/[id]/page.tsx equivalent for the same underlying rows:
    // link from project relation + repoKey, transitions via the literal map,
    // now via quantizedNowMs().
    const harnessPageArgs = [
      USER_ID,
      { projectId: PROJECT_ID, repoKey: REPO_KEY },
      DETAIL_PAGE_TRANSITIONS.map((row) => ({
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        toBatch: row.toBatch,
        batchBoundary: row.batchBoundary,
        fixRounds: row.fixRounds,
        observedAt: row.observedAt
      })),
      harnessCost.quantizedNowMs()
    ];

    // JSON.stringify is exactly the per-invocation discriminator unstable_cache
    // appends to its cache key: byte equality here = same key = same cached value.
    expect(JSON.stringify(spy.mock.calls[0])).toBe(JSON.stringify(harnessPageArgs));
    // and within a pinned 30s window the quantized now is stable
    expect(harnessCost.quantizedNowMs()).toBe(NOW.getTime());
  });

  it("does not render the card at all when no harnessProject is linked (acceptance 2)", async () => {
    mocks.prisma.harnessProject.findMany.mockResolvedValue([]);
    const markup = await renderPage();

    expect(markup).not.toContain("Orchestration batch cost");
    expect(vi.mocked(harnessCost.getBatchCost)).not.toHaveBeenCalled();
    expect(mocks.prisma.usageEvent.groupBy).not.toHaveBeenCalled();
  });

  it("keeps the card for a linked project without transitions, shows em-dash, and issues no usage query", async () => {
    mocks.prisma.harnessProject.findMany.mockResolvedValue([{ ...HP_ROW, transitions: [] }]);
    const markup = await renderPage();

    expect(markup).toContain("Orchestration batch cost");
    expect(markup).toContain('href="/harness/hp-1"');
    expect(markup).toContain("—");
    expect(mocks.prisma.usageEvent.groupBy).not.toHaveBeenCalled();
  });
});
