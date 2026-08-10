/**
 * Evaluator-owned smoke render for BL-COST-BATCH-V1 F002 (overview batch-cost card).
 *
 * Written in a fresh context at SHA c27fb38. The acceptance items "card renders
 * total / per-phase rows / rework subtotal", "empty state without transitions"
 * and "unlinked state when both link keys fail" are UI assertions that cannot be
 * exercised against an authenticated live page in the L1 environment, so this
 * test renders the real `OverviewView` server component (which embeds the
 * private `BatchCostSection`) to static markup with the real en messages:
 *  - next-intl is replaced by a resolver over the actual messages/en.json, so
 *    any key referenced by the view but missing from the bundle fails the test;
 *  - the BatchCost fixture is built from the public `BatchCost` contract of
 *    src/server/harness-cost.ts, not copied from implementation internals.
 *
 * Asserted acceptance surface (spec F002 acceptance 1 / 2 / 3 / 4-UI half):
 *  (a) linked + batchCost -> three elements (batch total, compute tokens,
 *      rework subtotal) + one row per phase (label / window / duration /
 *      compute / cost), fix-round badge on fixing/reverifying rows, "ongoing"
 *      tail for the open-ended phase, and the precision-note disclaimer;
 *  (b) linked + null batchCost (no transitions) -> empty-state copy, no table;
 *  (c) unlinked (projectId and repoKey both null) -> unlinked copy, not the
 *      empty copy;
 *  (d) window timestamps go through formatDateTimeSeconds with the caller's
 *      timezone.
 */
import * as React from "react";
import { createElement } from "react";
// BatchCostSection is a nested async server component; the legacy sync
// renderToStaticMarkup cannot resolve it (suspends), so this test uses the
// React 19 static prerender API which awaits all async components.
import { prerenderToNodeStream } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatDateTimeSeconds, formatTokens, formatUsd } from "@/shared/format";
import type { OwnedHarnessProjectDetail } from "@/server/harness-detail";
import type { BatchCost } from "@/server/harness-cost";

// vitest's esbuild transform compiles the app's JSX with the classic runtime;
// provide the React global before pulling in the server component module.
(globalThis as Record<string, unknown>).React = React;
const { OverviewView } = await import("../../app/harness/[id]/views");

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

const NOW = new Date("2026-08-10T12:00:00.000Z");
const MINUTE = 60 * 1000;
const at = (minutesBeforeNow: number) => new Date(NOW.getTime() - minutesBeforeNow * MINUTE);
const iso = (minutesBeforeNow: number) => at(minutesBeforeNow).toISOString();

function project(overrides: Record<string, unknown> = {}): OwnedHarnessProjectDetail {
  return {
    id: "hp-1",
    name: "tokenizer",
    repoKey: "github.com/x/tokenizer",
    status: "verifying",
    batch: "BL-COST-BATCH-V1",
    fixRounds: 1,
    completedCount: 4,
    totalCount: 5,
    headSha: "c27fb38",
    signoff: null,
    dashboardUrl: null,
    autonomyStatus: null,
    lastHaltCondition: null,
    lastHaltDetail: null,
    features: [],
    modes: null,
    reportedAt: at(1),
    createdAt: at(180),
    updatedAt: at(1),
    device: {
      id: "d1",
      name: "macbook",
      hostname: "host.local",
      platform: "darwin",
      lastSeenAt: at(1),
      agentVersion: "1.4.0",
      agentFeatureVersion: 9
    },
    project: { id: "p1", name: "tokenizer", repoKey: "github.com/x/tokenizer" },
    gates: [],
    modeIntents: [],
    transitions: [],
    dispatchRuns: [],
    ...overrides
  } as unknown as OwnedHarnessProjectDetail;
}

const BATCH_COST: BatchCost = {
  batch: "BL-COST-BATCH-V1",
  totalCostUsd: 12.3456,
  totalComputeTokens: 1_234_000,
  phases: [
    {
      phase: "building",
      batch: "BL-COST-BATCH-V1",
      fixRounds: 0,
      startIso: iso(180),
      endIso: iso(115),
      openEnded: false,
      durationMs: 65 * MINUTE,
      computeTokens: 900_000,
      costUsd: 9.87
    },
    {
      phase: "fixing",
      batch: "BL-COST-BATCH-V1",
      fixRounds: 1,
      startIso: iso(115),
      endIso: iso(85),
      openEnded: false,
      durationMs: 30 * MINUTE,
      computeTokens: 200_000,
      costUsd: 1.5
    },
    {
      phase: "reverifying",
      batch: "BL-COST-BATCH-V1",
      fixRounds: 1,
      startIso: iso(85),
      endIso: iso(0),
      openEnded: true,
      durationMs: 85 * MINUTE,
      computeTokens: 134_000,
      costUsd: 0.9756
    }
  ],
  reworkCostUsd: 2.4756,
  reworkComputeTokens: 334_000,
  windowStartIso: iso(180),
  windowEndIso: iso(0)
};

async function renderOverview(
  batchCost: BatchCost | null,
  costLinked: boolean,
  timezone = "UTC",
  overrides: Record<string, unknown> = {}
) {
  const element = await OverviewView({ project: project(overrides), timezone, batchCost, costLinked });
  const { prelude } = await prerenderToNodeStream(createElement("div", null, element));
  const chunks: Buffer[] = [];
  for await (const chunk of prelude) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(() => {
  // Fake Date only: the prerender stream relies on real task scheduling.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("BL-COST-BATCH-V1 F002 overview batch-cost card smoke render (en messages, real component)", () => {
  it("renders total, compute tokens, rework subtotal, per-phase rows and the precision note when linked with cost data", async () => {
    const markup = await renderOverview(BATCH_COST, true);

    // card title + the three card elements (acceptance 1)
    expect(markup).toContain("Batch cost");
    expect(markup).toContain("Batch total");
    expect(markup).toContain(formatUsd(12.3456)); // $12.35
    expect(markup).toContain("Compute tokens");
    expect(markup).toContain(formatTokens(1_234_000));
    expect(markup).toContain("Rework subtotal (fixing + reverifying)");
    expect(markup).toContain(formatUsd(2.4756)); // $2.48
    expect(markup).toContain(formatTokens(334_000));

    // one row per phase with status-namespace labels and per-row cost/compute
    for (const label of ["Building", "Fixing", "Reverifying"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain(formatUsd(9.87));
    expect(markup).toContain(formatUsd(1.5));
    expect(markup).toContain(formatUsd(0.9756)); // sub-cent precision path
    expect(markup).toContain(formatTokens(900_000));

    // table headers
    for (const header of ["Phase", "Window", "Duration", "Cost"]) {
      expect(markup).toContain(header);
    }

    // durations via timelineDuration
    expect(markup).toContain("1h 5m");
    expect(markup).toContain("30m");

    // fix-round badge on fixing/reverifying rows (fixRounds > 0); streamed
    // markup may split the "#" and the number with a text-node separator
    expect(markup).toMatch(/#(<!-- -->)?1</);

    // open-ended phase tail renders "ongoing" instead of an end timestamp
    expect(markup).toContain("ongoing");

    // precision disclaimer (acceptance 2, en copy verbatim)
    expect(markup).toContain(
      "Time-window approximation: usage from the same project in the same window that is not part of this batch is also counted (errs on over-counting, never under). Phase boundaries are mirror observations (≤2 min lag). Exact per-batch attribution arrives in v2."
    );
  });

  it("renders the empty-state copy (not a table, not an error) when linked but no transitions produced cost data", async () => {
    const markup = await renderOverview(null, true);
    expect(markup).toContain("Batch cost");
    expect(markup).toContain(
      "No phase transitions recorded yet — cost attribution starts with the first status change report."
    );
    expect(markup).not.toContain("Not linked to a usage project");
    expect(markup).not.toContain("Batch total");
  });

  it("renders the unlinked copy when both projectId and repoKey are unavailable", async () => {
    const markup = await renderOverview(null, false, "UTC", {
      project: null,
      repoKey: "github.com/x/tokenizer"
    });
    expect(markup).toContain("Batch cost");
    expect(markup).toContain("Not linked to a usage project, so no usage can be attributed.");
    expect(markup).not.toContain("No phase transitions recorded yet");
    expect(markup).not.toContain("Batch total");
  });

  it("formats window timestamps with the caller timezone via formatDateTimeSeconds", async () => {
    const markup = await renderOverview(BATCH_COST, true, "Asia/Shanghai");
    const start = new Date(BATCH_COST.phases[0].startIso);
    expect(markup).toContain(formatDateTimeSeconds(start, "Asia/Shanghai"));
    expect(markup).not.toContain(formatDateTimeSeconds(start, "UTC"));
  });
});
