/**
 * BL-AGENT-RELEASE-ACCEPTANCE — independent Evaluator probes (2026-08-04).
 *
 * These are written fresh against the acceptance criteria in
 * docs/specs/BL-AGENT-RELEASE-ACCEPTANCE-spec.md, NOT derived from the
 * shipped tests/cli/* suites. They assert observable parser/lock/identity
 * behaviour from the outside so a green shipped suite cannot, by itself,
 * carry the verdict.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readDispatchToolInventory } from "@/cli/harness-tool-catalog";
import { acquireAgentLock } from "@/cli/agent-lock";
import {
  AGENT_FEATURE_VERSION,
  MAX_AGENT_FEATURE_VERSION,
  MIN_AGENT_FEATURE_VERSION,
  MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_HARNESS_REPORTER_IDENTITY_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";
import { modeIssuanceBlocker } from "@/shared/harness-detail";
import { parseHarnessRelayAgentIdentity } from "@/server/harness-relay-identity";
import {
  HARNESS_RELAY_AGENT_FEATURE_VERSION_HEADER as FEATURE_HEADER,
  HARNESS_RELAY_AGENT_RELEASE_VERSION_HEADER as RELEASE_HEADER
} from "@/shared/harness-relay-identity";

let repo: string;

function write(rel: string, value: unknown): void {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
}

/** A minimally valid, _verified local-cli adapter for tool `probecli`. */
function writeProbeAdapter(): void {
  write(".claude/dispatch/transports/adapters/probecli.json", {
    name: "probecli",
    _verified: true,
    tool: "probecli",
    model_family: "probe-family",
    argv: ["probecli", "--run"],
    envelope_delivery: "stdin"
  });
}

function integration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "probe",
    tool: "probecli",
    label: "Probe CLI",
    model_family: "probe-family",
    priority: 10,
    capabilities: ["probe"],
    local_cli: { adapter: "probecli", sandbox: { home_dir: "/tmp/probe-home" }, timeout_s: 60 },
    ...overrides
  };
}

function registry(integrations: unknown[]): void {
  write(".agents-registry.json", {
    version: "tool-integrations/1",
    integrations,
    a2a_targets: []
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "eval-release-acceptance-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("F001 · capability 8 catalog recovery", () => {
  it("baseline: a plain local-cli integration publishes exactly one local-cli route", () => {
    writeProbeAdapter();
    registry([integration()]);

    const inventory = readDispatchToolInventory(repo);
    expect(inventory.catalog.issue).toBeNull();
    expect(inventory.catalog.entries.length).toBeGreaterThan(0);
    expect(new Set(inventory.catalog.entries.map((e) => e.invocation))).toEqual(new Set(["local-cli"]));
    expect(inventory.integrations.integrations).toHaveLength(1);
    expect(inventory.integrations.integrations[0].invocations).toEqual(["local-cli"]);
  });

  it("decision 3: a legacy `subagent: true` boolean never re-publishes an external subagent route", () => {
    writeProbeAdapter();
    registry([integration({ subagent: true })]);

    const inventory = readDispatchToolInventory(repo);
    // The local-cli half must survive (that is the "recovery" half of 1.2.0)…
    expect(inventory.catalog.issue).toBeNull();
    const published = inventory.integrations.integrations;
    expect(published).toHaveLength(1);

    // …but the boolean must not become a selectable/tool-labelled route.
    expect(published[0].subagent).toBe(false);
    expect(published[0].invocations).not.toContain("subagent");
    expect(published[0].bridgeId).toBeNull();
    expect(published[0].bridgeKind).toBeNull();
    expect(published[0].sessionScope).toBeNull();
    expect(published[0].subagentProvider ?? null).toBeNull();
    expect(inventory.catalog.entries.some((e) => e.invocation === "subagent")).toBe(false);
    expect(inventory.catalog.entries.some((e) => e.subagentProvider)).toBe(false);
  });

  it("decision 3: `subagent: true` alone (no local_cli) publishes no integration at all", () => {
    registry([integration({ subagent: true, local_cli: undefined })]);

    const inventory = readDispatchToolInventory(repo);
    expect(inventory.integrations.integrations).toHaveLength(0);
    expect(inventory.catalog.entries).toHaveLength(0);
  });

  it("decision 2 (fail-closed): an unresolvable object bridge degrades the WHOLE catalog, never partially", () => {
    writeProbeAdapter();
    registry([
      integration(),
      integration({ id: "broken", subagent: { bridge: "no-such-bridge" } })
    ]);

    const inventory = readDispatchToolInventory(repo);
    // Fail-closed: the healthy sibling integration is withheld too, rather than
    // letting a half-parsed registry through.
    expect(inventory.catalog.issue).toBe("dispatch tool catalog is unavailable");
    expect(inventory.catalog.entries).toHaveLength(0);
    expect(inventory.integrations.issue).toBe("dispatch tool catalog is unavailable");
    expect(inventory.integrations.integrations).toHaveLength(0);
  });

  it("decision 2 (fail-closed): a malformed subagent declaration shape degrades the catalog", () => {
    writeProbeAdapter();
    for (const malformed of [{ bridge: 1 }, { bridge: "ok", extra: true }, {}, "bridge", []]) {
      registry([integration({ subagent: malformed })]);
      const inventory = readDispatchToolInventory(repo);
      expect(inventory.catalog.issue).toBe("dispatch tool catalog is unavailable");
      expect(inventory.catalog.entries).toHaveLength(0);
    }
  });

  it("decision 2: an object bridge declaration cannot ride in without a local_cli contract", () => {
    registry([integration({ local_cli: undefined, subagent: { bridge: "some-bridge" } })]);
    const inventory = readDispatchToolInventory(repo);
    expect(inventory.catalog.issue).toBe("dispatch tool catalog is unavailable");
  });

  it("decision 2: capability 8 is the tool-binding mode-intent floor", () => {
    expect(MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION).toBe(8);
    expect(MIN_MODE_INTENT_AGENT_FEATURE_VERSION).toBeLessThan(
      MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
    );
  });

  it("decision 4: console blockers are mutually exclusive and ordered freshness → upgrade → version → empty catalog", () => {
    const fresh = new Date("2026-08-04T08:00:00Z");
    const now = fresh.getTime() + 1_000;
    const usableModes = {
      dispatch: { agentSnapshotUsable: true, toolCatalogUsable: true }
    } as never;

    // 0. signing key precedes everything.
    expect(
      modeIssuanceBlocker({
        signingKeyReady: false,
        reportedAt: null,
        agentFeatureVersion: 0,
        headSha: null,
        modes: null,
        now,
        requiresToolBindings: true
      })
    ).toBe("signingKeyUnavailable");

    // 1. Staleness outranks the upgrade requirement …
    expect(
      modeIssuanceBlocker({
        signingKeyReady: true,
        reportedAt: new Date("2020-01-01T00:00:00Z"),
        agentFeatureVersion: 1,
        headSha: null,
        modes: null,
        now,
        requiresToolBindings: true
      })
    ).toBe("reportStale");

    // 2. … which in turn outranks version verification (headSha).
    expect(
      modeIssuanceBlocker({
        signingKeyReady: true,
        reportedAt: fresh,
        agentFeatureVersion: 1,
        headSha: null,
        modes: null,
        now,
        requiresToolBindings: true
      })
    ).toBe("agentUpgradeRequired");

    // 2b. A capability-7 agent asked for tool bindings gets the tool-binding
    //     upgrade reason specifically, not the generic one.
    expect(
      modeIssuanceBlocker({
        signingKeyReady: true,
        reportedAt: fresh,
        agentFeatureVersion: 7,
        headSha: null,
        modes: null,
        now,
        requiresToolBindings: true
      })
    ).toBe("toolBindingAgentUpgradeRequired");

    // 2c. The same capability-7 agent is NOT blocked on v1 intents.
    expect(
      modeIssuanceBlocker({
        signingKeyReady: true,
        reportedAt: fresh,
        agentFeatureVersion: 7,
        headSha: "a".repeat(40),
        modes: usableModes,
        now,
        requiresToolBindings: false
      })
    ).toBeNull();

    // 3. Version verification outranks the empty-catalog reason.
    expect(
      modeIssuanceBlocker({
        signingKeyReady: true,
        reportedAt: fresh,
        agentFeatureVersion: 8,
        headSha: "short",
        modes: null,
        now,
        requiresToolBindings: true
      })
    ).toBe("headNotFull");

    // 4. Compatible-but-empty catalog is last and actionable on its own.
    expect(
      modeIssuanceBlocker({
        signingKeyReady: true,
        reportedAt: fresh,
        agentFeatureVersion: 8,
        headSha: "a".repeat(40),
        modes: { dispatch: { agentSnapshotUsable: true, toolCatalogUsable: false } } as never,
        now,
        requiresToolBindings: true
      })
    ).toBe("toolCatalogUnavailable");

    // Fully healthy capability-8 agent: no blocker.
    expect(
      modeIssuanceBlocker({
        signingKeyReady: true,
        reportedAt: fresh,
        agentFeatureVersion: 8,
        headSha: "a".repeat(40),
        modes: usableModes,
        now,
        requiresToolBindings: true
      })
    ).toBeNull();
  });
});

describe("F002 · capability 9 single-instance lifecycle", () => {
  it("a live PID holding the lock rejects a second Agent instance", () => {
    const path = join(repo, "agent.lock");
    const first = acquireAgentLock({ path, pid: process.pid });
    try {
      expect(() => acquireAgentLock({ path, pid: process.pid })).toThrow(/already running/i);
      // The incumbent record is untouched by the refused acquisition.
      expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
    } finally {
      first.release();
    }
  });

  it("a dead PID's stale lock is reclaimed by the next start", () => {
    const path = join(repo, "agent.lock");
    // A PID that cannot be live: reserve one and prove it is gone.
    const deadPid = 2_147_483_646;
    let dead = false;
    try {
      process.kill(deadPid, 0);
    } catch (error) {
      dead = (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    expect(dead).toBe(true);

    writeFileSync(path, `${JSON.stringify({ pid: deadPid, token: "stale", startedAt: "" })}\n`);
    const lock = acquireAgentLock({ path, pid: process.pid });
    try {
      expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
    } finally {
      lock.release();
    }
  });

  it("a corrupt lock file is reclaimed rather than deadlocking startup", () => {
    const path = join(repo, "agent.lock");
    writeFileSync(path, "{ not json");
    const lock = acquireAgentLock({ path, pid: process.pid });
    try {
      expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
    } finally {
      lock.release();
    }
  });

  it("release() never deletes a successor's lock (the upgrade race)", () => {
    const path = join(repo, "agent.lock");
    const outgoing = acquireAgentLock({ path, pid: process.pid });

    // Simulate the successor daemon taking the slot after the outgoing one
    // lost its PID but before its release() ran.
    rmSync(path, { force: true });
    const successorRecord = `${JSON.stringify({
      pid: process.pid,
      token: "successor-token",
      startedAt: new Date().toISOString()
    })}\n`;
    writeFileSync(path, successorRecord);

    outgoing.release();

    // The successor's lock must still be there.
    expect(readFileSync(path, "utf8")).toBe(successorRecord);
    rmSync(path, { force: true });
  });

  it("release() is idempotent and removes only its own record", () => {
    const path = join(repo, "agent.lock");
    const lock = acquireAgentLock({ path, pid: process.pid });
    lock.release();
    lock.release();
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  it("capability 9 is the reporter-identity floor and the shipped release level", () => {
    expect(MIN_HARNESS_REPORTER_IDENTITY_AGENT_FEATURE_VERSION).toBe(9);
    expect(AGENT_FEATURE_VERSION).toBe(9);
    // Decision 2: the global upgrade floor was raised in lockstep.
    expect(MIN_AGENT_FEATURE_VERSION).toBe(9);
  });

  it("decision 3: a capability ceiling exists so malformed values cannot pin reporters as stale forever", () => {
    expect(Number.isSafeInteger(MAX_AGENT_FEATURE_VERSION)).toBe(true);
    expect(MAX_AGENT_FEATURE_VERSION).toBeGreaterThan(AGENT_FEATURE_VERSION);
  });

  it("decision 4: relay identity is atomic — a half-supplied identity cannot become a compatibility fallback", () => {
    const relay = (headers: Record<string, string>) =>
      parseHarnessRelayAgentIdentity(new Request("https://example.test/relay", { headers }));

    // No headers at all = the legacy pre-capability-9 path.
    expect(relay({})).toBeNull();

    // Exactly one of the pair is a hard error, never a silent downgrade.
    expect(() => relay({ [RELEASE_HEADER]: "1.2.1" })).toThrow();
    expect(() => relay({ [FEATURE_HEADER]: "9" })).toThrow();

    // A well-formed pair parses.
    expect(relay({ [RELEASE_HEADER]: "1.2.1", [FEATURE_HEADER]: "9" })).toEqual({
      releaseVersion: "1.2.1",
      featureVersion: 9
    });
  });

  it("decision 3: a malformed/oversized capability header is rejected, not accepted as 'newest forever'", () => {
    const relay = (feature: string) =>
      parseHarnessRelayAgentIdentity(
        new Request("https://example.test/relay", {
          headers: { [RELEASE_HEADER]: "1.2.1", [FEATURE_HEADER]: feature }
        })
      );

    // NB: " 9" is deliberately absent. The Fetch `Headers` implementation
    // trims header values before the parser ever runs, so it is normalised to
    // "9" by HTTP semantics rather than by this code.
    for (const bogus of ["99999999", "1e9", "-1", "9.5", "NaN", "Infinity", "0x9", ""]) {
      expect(() => relay(bogus)).toThrow();
    }
    // The ceiling is a real boundary: values above it are refused even though
    // they are syntactically well-formed integers.
    expect(() => relay(String(MAX_AGENT_FEATURE_VERSION + 1))).toThrow();
    expect(() => relay("9999999")).toThrow();
    // …and the boundary value itself is still accepted.
    expect(relay(String(MAX_AGENT_FEATURE_VERSION))?.featureVersion).toBe(MAX_AGENT_FEATURE_VERSION);
  });
});
