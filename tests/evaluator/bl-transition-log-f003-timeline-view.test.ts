/**
 * Evaluator-owned smoke render for BL-TRANSITION-LOG F003 (detail page timeline tab).
 *
 * Written in a fresh context at SHA a48f0f9. The acceptance item "renders grouped
 * timeline / durations / precision badges / empty placeholder" cannot be exercised
 * against a live DB in the L1 environment, so this test renders the real
 * `TimelineView` server component to static markup with the real en messages:
 *  - next-intl is replaced by a resolver over the actual messages/en.json, so any
 *    key referenced by the view but missing from the bundle fails the test;
 *  - transition rows are rebuilt here from the public TransitionRow contract,
 *    not copied from implementation fixtures.
 *
 * Asserted acceptance surface:
 *  (a) empty transitions -> precision note + empty placeholder;
 *  (b) grouped rendering: one card per batch (boundary row opens a new group),
 *      measured total, per-segment durations, ">=" lower-bound prefix on the
 *      initial-observation segment, fix-round badge, lowPrecision badge,
 *      in-progress tail only timed because the report is fresh;
 *  (c) timestamps go through formatDateTimeSeconds with the caller's timezone.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatDateTimeSeconds } from "@/shared/format";
import type { OwnedHarnessProjectDetail } from "@/server/harness-detail";

// vitest's esbuild transform compiles the app's JSX with the classic runtime;
// provide the React global before pulling in the server component module.
(globalThis as Record<string, unknown>).React = React;
const { TimelineView } = await import("../../app/harness/[id]/views");

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

const NOW = new Date("2026-08-09T16:00:00.000Z");
const MINUTE = 60 * 1000;
const at = (minutesBeforeNow: number) => new Date(NOW.getTime() - minutesBeforeNow * MINUTE);

type TransitionRows = OwnedHarnessProjectDetail["transitions"];

function project(transitions: unknown[], reportedAt: Date): OwnedHarnessProjectDetail {
  return {
    transitions: transitions as TransitionRows,
    reportedAt
  } as unknown as OwnedHarnessProjectDetail;
}

function transitionRow(overrides: Record<string, unknown>) {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    fromStatus: null,
    toStatus: "planning",
    fromBatch: null,
    toBatch: null,
    batchBoundary: false,
    fixRounds: 0,
    headSha: null,
    observedAfter: null,
    observedAt: NOW,
    ...overrides
  };
}

async function renderTimeline(transitions: unknown[], reportedAt: Date, timezone = "UTC") {
  const element = await TimelineView({ project: project(transitions, reportedAt), timezone });
  return renderToStaticMarkup(createElement("div", null, element));
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("BL-TRANSITION-LOG F003 TimelineView smoke render (en messages, real component)", () => {
  it("renders the precision note and the empty placeholder when no transitions exist", async () => {
    const markup = await renderTimeline([], at(1));
    expect(markup).toContain(
      "Observed from 60s agent polling: timings are approximate; gaps while the agent was offline are unbounded, and phases crossed within one poll are compressed. progress.json git history stays authoritative."
    );
    expect(markup).toContain("No transitions observed yet. Rows appear as the agent reports state changes.");
  });

  it("renders batch groups, durations, lower-bound prefix, fix-round and precision badges", async () => {
    // Rows arrive observedAt-desc, mirroring the harness-detail query ordering.
    const rows = [
      transitionRow({
        // batch boundary opens group B2; in-progress tail, report fresh -> timed
        fromStatus: "fixing",
        toStatus: "planning",
        fromBatch: "B1",
        toBatch: "B2",
        batchBoundary: true,
        observedAfter: at(31),
        observedAt: at(30)
      }),
      transitionRow({
        // fixing with fixRounds=1 -> round badge
        fromStatus: "verifying",
        toStatus: "fixing",
        fromBatch: "B1",
        toBatch: "B1",
        fixRounds: 1,
        observedAfter: at(46),
        observedAt: at(45)
      }),
      transitionRow({
        // 15-minute observation gap > 10-minute threshold -> lowPrecision badge
        fromStatus: "building",
        toStatus: "verifying",
        fromBatch: "B1",
        toBatch: "B1",
        observedAfter: at(75),
        observedAt: at(60)
      }),
      transitionRow({
        fromStatus: "planning",
        toStatus: "building",
        fromBatch: "B1",
        toBatch: "B1",
        observedAfter: at(91),
        observedAt: at(90)
      }),
      transitionRow({
        // initial observation row: duration is a lower bound, excluded from total
        fromStatus: null,
        toStatus: "planning",
        toBatch: "B1",
        observedAt: at(120)
      })
    ];

    const markup = await renderTimeline(rows, at(1));

    // grouped: one card header per batch, boundary row starts B2
    expect(markup).toContain("B1");
    expect(markup).toContain("B2");
    // measured total for B1 = building 30m + verifying 15m + fixing 15m = 1h 0m
    // (the >=30m initial planning segment must stay excluded)
    expect(markup).toContain("measured total 1h 0m");
    // initial observation segment rendered as a lower bound
    expect(markup).toContain("≥30m");
    // fix-round badge on the fixing segment
    expect(markup).toContain("round 1");
    // lowPrecision badge + hint tooltip
    expect(markup).toContain("imprecise");
    expect(markup).toContain("Observation gap exceeded 10 minutes");
    // fresh report -> the open B2 tail is honestly timed
    expect(markup).toContain("in progress for 30m");
    // phase labels come from harness.status.phase.*
    for (const label of ["Planning", "Building", "Verifying", "Fixing"]) {
      expect(markup).toContain(label);
    }
  });

  it("does not time the open tail when the report is stale, and flags non-adjacent edges", async () => {
    const rows = [
      transitionRow({
        // planning -> fixing is not a legal adjacent edge -> compressed badge
        fromStatus: "planning",
        toStatus: "fixing",
        fromBatch: "B1",
        toBatch: "B1",
        observedAfter: at(41),
        observedAt: at(40)
      }),
      transitionRow({ fromStatus: null, toStatus: "planning", toBatch: "B1", observedAt: at(50) })
    ];
    // reportedAt 30 minutes ago -> outside the 20-minute fresh window
    const markup = await renderTimeline(rows, at(30));
    expect(markup).toContain("compressed");
    expect(markup).toContain("Not an adjacent state-machine edge");
    expect(markup).not.toContain("in progress for");
    expect(markup).toContain("in progress");
  });

  it("formats segment timestamps with the caller timezone via formatDateTimeSeconds", async () => {
    const observedAt = at(120);
    const rows = [transitionRow({ fromStatus: null, toStatus: "planning", toBatch: "B1", observedAt })];
    const markup = await renderTimeline(rows, at(1), "Asia/Shanghai");
    expect(markup).toContain(formatDateTimeSeconds(observedAt, "Asia/Shanghai"));
    expect(markup).not.toContain(formatDateTimeSeconds(observedAt, "UTC"));
  });
});
