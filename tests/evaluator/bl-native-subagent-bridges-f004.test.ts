/**
 * Evaluator-owned reverification probe for BL-NATIVE-SUBAGENT-BRIDGES F004.
 *
 * Written in a fresh context at SHA 172ed42b5c4d910c7f194a6fab835c8ac74f19e7.
 * It deliberately does not reuse the implementation's fixtures: every shape is
 * rebuilt here from the public types so a regression in the product fixtures
 * cannot mask a regression in the product behaviour.
 *
 * F004 acceptance under test:
 *  (a) `heterogeneous` may combine a verified external same-session bridge with
 *      a local-cli tool, still refuses a2a, and still requires distinct
 *      generator/evaluator model families.
 *  (b) The TypeScript catalog mirror, the server-side intent validation and the
 *      existing dynamic three-role UI agree on the same accept/reject verdict,
 *      with no new tool-name special casing.
 *  (c) Coordinator-host-native and same-session bridge routes are worded
 *      distinguishably.
 */
import React, { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  isV2SelectableToolCatalogEntry,
  toolCatalogModeDescriptors,
  v2SelectableToolCatalogEntries,
  type HarnessToolCatalogEntry
} from "@/shared/harness-tool-catalog";
import {
  validateHarnessModeIntentPayload,
  type HarnessModeToolDescriptor
} from "@/shared/harness-mode-intent";
import { modeToolCatalogFromSnapshot, parseModeSnapshot } from "@/server/harness-mode-intent-api";
import { MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";

function translate(key: string, values?: Record<string, unknown>): string {
  if (values && Object.keys(values).length > 0) {
    return `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(",")})`;
  }
  return key;
}
Object.assign(translate, { has: () => true });

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => translate }));

// eslint-disable-next-line import/first
import { initialNonFastBindingsForProfile, ModeEditor } from "../../app/harness/[id]/mode-editor";

// The editor components read the wall clock directly (a provider proof is only
// selectable inside its short validity window), so the probe anchors on the
// real current time instead of a frozen literal.
const NOW = new Date();
const HEAD = "9".repeat(40);
const DIGEST = (seed: string) => seed.repeat(64).slice(0, 64);

function liveProof(now: Date = NOW, ttlMs = 120_000) {
  return {
    id: "harness-vm-v1",
    kind: "vm-v1",
    contractSha256: DIGEST("a"),
    attestation: {
      version: "harness/external-bridge-provider-attestation/1",
      providerId: "harness-vm-v1",
      providerKind: "vm-v1",
      contractSha256: DIGEST("a"),
      phase: "catalog",
      nonceSha256: DIGEST("b"),
      issuedAt: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      imageSha256: DIGEST("c"),
      runnerSha256: DIGEST("d"),
      cliBundleSha256: DIGEST("e"),
      brokerPolicySha256: DIGEST("f")
    }
  };
}

/** A proof that was valid ten minutes ago and must no longer be selectable. */
function staleProof() {
  return liveProof(new Date(NOW.getTime() - 10 * 60 * 1_000));
}

type CatalogSeed = {
  tool: string;
  family: string;
  invocation: "subagent" | "local-cli" | "a2a";
  roles: Array<"planner" | "generator" | "evaluator">;
  proof?: ReturnType<typeof liveProof>;
};

function catalogEntries(seeds: readonly CatalogSeed[]): HarnessToolCatalogEntry[] {
  return seeds.flatMap((seed) =>
    seed.roles.map((role) => ({
      tool: seed.tool,
      label: `${seed.tool} label`,
      invocation: seed.invocation,
      role,
      agentCount: 1,
      modelFamilies: [seed.family],
      capabilities: ["plan", "build", "verify"],
      ...(seed.proof ? { subagentProvider: seed.proof } : {})
    })) as HarnessToolCatalogEntry[]
  );
}

/** Kimi bridge (proved) + Codex local-cli: the canonical F004 combination. */
const PROVED_BRIDGE_CATALOG = catalogEntries([
  { tool: "kimi", family: "kimi", invocation: "subagent", roles: ["planner", "generator", "evaluator"], proof: liveProof() },
  { tool: "codex", family: "codex", invocation: "local-cli", roles: ["planner", "generator", "evaluator"] }
]);

/** Identical topology under names the product has never heard of. */
const FUTURE_TOOL_CATALOG = catalogEntries([
  { tool: "acme-cli", family: "acme", invocation: "subagent", roles: ["planner", "generator", "evaluator"], proof: liveProof() },
  { tool: "zeta-cli", family: "zeta", invocation: "local-cli", roles: ["planner", "generator", "evaluator"] }
]);

const UNPROVED_BRIDGE_CATALOG = catalogEntries([
  { tool: "kimi", family: "kimi", invocation: "subagent", roles: ["planner", "generator", "evaluator"] },
  { tool: "codex", family: "codex", invocation: "local-cli", roles: ["planner", "generator", "evaluator"] }
]);

const STALE_BRIDGE_CATALOG = catalogEntries([
  { tool: "kimi", family: "kimi", invocation: "subagent", roles: ["planner", "generator", "evaluator"], proof: staleProof() },
  { tool: "codex", family: "codex", invocation: "local-cli", roles: ["planner", "generator", "evaluator"] }
]);

function intent(
  execution: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    intent_id: "intent-f004-probe",
    repo_key: "github.com/example/tokenizer",
    expected_head_sha: HEAD,
    desired: { execution, autonomy: { enabled: false } },
    issued_by: "evaluator-probe",
    issued_at: new Date(NOW.getTime() - 60_000).toISOString(),
    intent_expires_at: new Date(NOW.getTime() + 24 * 3_600_000).toISOString(),
    ...overrides
  };
}

function bindings(
  generator: { tool: string; invocation: string },
  evaluator: { tool: string; invocation: string },
  planner: { tool: string; invocation: string } | null = null
) {
  return { planner, generator, evaluator };
}

function validate(execution: Record<string, unknown>, tools: readonly HarnessModeToolDescriptor[]) {
  return validateHarnessModeIntentPayload(intent(execution), { now: NOW, tools });
}

function descriptorsFor(entries: readonly HarnessToolCatalogEntry[], now: Date = NOW) {
  return toolCatalogModeDescriptors(v2SelectableToolCatalogEntries(entries, now));
}

describe("F004 (a) heterogeneous issuance semantics", () => {
  it("signs a proved external same-session bridge paired with a local-cli tool", () => {
    const tools = descriptorsFor(PROVED_BRIDGE_CATALOG);
    expect(tools).toContainEqual({ tool: "kimi", invocation: "subagent", role: "generator", model_family: "kimi" });

    const result = validate(
      {
        profile: "heterogeneous",
        role_bindings: bindings(
          { tool: "kimi", invocation: "subagent" },
          { tool: "codex", invocation: "local-cli" }
        )
      },
      tools
    );
    expect(result).toMatchObject({ ok: true });
    if (!("value" in result)) throw new Error("expected an accepted intent");
    expect(result.value.desired.execution).toEqual({
      profile: "heterogeneous",
      role_bindings: {
        planner: null,
        generator: { tool: "kimi", invocation: "subagent" },
        evaluator: { tool: "codex", invocation: "local-cli" }
      }
    });
    // The signed shape stays free of provider material and agent identity.
    const signed = JSON.stringify(result.value);
    expect(signed).not.toContain("harness-vm-v1");
    expect(signed).not.toContain("subagentProvider");
  });

  it("accepts the bridge in either direction, including as the Planner binding", () => {
    const tools = descriptorsFor(PROVED_BRIDGE_CATALOG);
    expect(validate(
      {
        profile: "heterogeneous",
        role_bindings: bindings(
          { tool: "codex", invocation: "local-cli" },
          { tool: "kimi", invocation: "subagent" },
          { tool: "kimi", invocation: "subagent" }
        )
      },
      tools
    )).toMatchObject({ ok: true });
  });

  it("still refuses a2a inside heterogeneous even when the bridge is proved", () => {
    const tools = [
      ...descriptorsFor(PROVED_BRIDGE_CATALOG),
      { tool: "codex", invocation: "a2a" as const, role: "evaluator" as const, model_family: "codex" }
    ];
    const result = validate(
      {
        profile: "heterogeneous",
        role_bindings: bindings(
          { tool: "kimi", invocation: "subagent" },
          { tool: "codex", invocation: "a2a" }
        )
      },
      tools
    );
    expect(result).toMatchObject({ ok: false });
    if ("value" in result) throw new Error("expected a rejected intent");
    expect(result.error.code).toBe("profile_transport_mismatch");
  });

  it("still requires distinct generator/evaluator model families across the bridge", () => {
    const tools = descriptorsFor(catalogEntries([
      { tool: "kimi", family: "kimi", invocation: "subagent", roles: ["generator", "evaluator"], proof: liveProof() },
      { tool: "kimi", family: "kimi", invocation: "local-cli", roles: ["generator", "evaluator"] }
    ]));
    const result = validate(
      {
        profile: "heterogeneous",
        role_bindings: bindings(
          { tool: "kimi", invocation: "subagent" },
          { tool: "kimi", invocation: "local-cli" }
        )
      },
      tools
    );
    expect(result).toMatchObject({ ok: false });
    if ("value" in result) throw new Error("expected a rejected intent");
    expect(result.error.code).toBe("same_model_family");
  });

  it("keeps slow bound to a2a, so a bridge cannot satisfy it", () => {
    const result = validate(
      {
        profile: "slow",
        role_bindings: bindings(
          { tool: "kimi", invocation: "subagent" },
          { tool: "codex", invocation: "local-cli" }
        )
      },
      descriptorsFor(PROVED_BRIDGE_CATALOG)
    );
    expect(result).toMatchObject({ ok: false });
    if ("value" in result) throw new Error("expected a rejected intent");
    expect(result.error.code).toBe("profile_transport_mismatch");
  });

  it("refuses to sign a bridge whose proof is absent or stale", () => {
    for (const catalog of [UNPROVED_BRIDGE_CATALOG, STALE_BRIDGE_CATALOG]) {
      const tools = descriptorsFor(catalog);
      expect(tools).not.toContainEqual(expect.objectContaining({ invocation: "subagent" }));
      const result = validate(
        {
          profile: "heterogeneous",
          role_bindings: bindings(
            { tool: "kimi", invocation: "subagent" },
            { tool: "codex", invocation: "local-cli" }
          )
        },
        tools
      );
      expect(result).toMatchObject({ ok: false });
      if ("value" in result) throw new Error("expected a rejected intent");
      expect(result.error.code).toBe("unknown_tool");
    }
  });
});

describe("F004 (b) catalog mirror / server / UI agree without tool-name special cases", () => {
  it("gates on the provider proof, not on the tool name", () => {
    const [kimiBridge] = PROVED_BRIDGE_CATALOG;
    const [acmeBridge] = FUTURE_TOOL_CATALOG;
    expect(isV2SelectableToolCatalogEntry(kimiBridge, NOW)).toBe(true);
    expect(isV2SelectableToolCatalogEntry(acmeBridge, NOW)).toBe(true);
    expect(isV2SelectableToolCatalogEntry(UNPROVED_BRIDGE_CATALOG[0], NOW)).toBe(false);
    expect(isV2SelectableToolCatalogEntry(STALE_BRIDGE_CATALOG[0], NOW)).toBe(false);

    // An unknown future CLI reaches exactly the same signable outcome.
    expect(validate(
      {
        profile: "heterogeneous",
        role_bindings: bindings(
          { tool: "acme-cli", invocation: "subagent" },
          { tool: "zeta-cli", invocation: "local-cli" }
        )
      },
      descriptorsFor(FUTURE_TOOL_CATALOG)
    )).toMatchObject({ ok: true });
  });

  it("carries no vendor identifier in the mode-intent or catalog mirror source", () => {
    const mirror = readFileSync("src/shared/harness-tool-catalog.ts", "utf8");
    const intentValidator = readFileSync("src/shared/harness-mode-intent.ts", "utf8");
    const serverApi = readFileSync("src/server/harness-mode-intent-api.ts", "utf8");
    const editor = readFileSync("app/harness/[id]/mode-editor.tsx", "utf8");
    for (const source of [mirror, intentValidator, serverApi, editor]) {
      expect(source.toLowerCase()).not.toMatch(/["'`](kimi|codex|claude-code)["'`]/);
    }
  });

  it("keeps the device snapshot, the server catalog and the UI selector on the same verdict", () => {
    const snapshot = bridgeSnapshot(liveProof());
    expect(parseModeSnapshot(snapshot)).toBe(snapshot);
    const serverDescriptors = modeToolCatalogFromSnapshot(snapshot, NOW);
    expect(serverDescriptors).toEqual(expect.arrayContaining([
      { tool: "kimi", invocation: "subagent", role: "generator", model_family: "kimi" },
      { tool: "codex", invocation: "local-cli", role: "evaluator", model_family: "codex" }
    ]));

    // Same facts through the UI selector.
    expect(initialNonFastBindingsForProfile(
      PROVED_BRIDGE_CATALOG as never,
      "heterogeneous"
    )).toMatchObject({
      plannerTool: "",
      plannerInvocation: "",
      generatorTool: expect.any(String),
      evaluatorTool: expect.any(String)
    });

    // A stale proof keeps the historical observation parseable, but the bridge
    // drops out of the signable catalog while the local-cli route survives.
    const stale = bridgeSnapshot(staleProof());
    expect(parseModeSnapshot(stale)).toBe(stale);
    const staleDescriptors = modeToolCatalogFromSnapshot(stale, NOW);
    expect(staleDescriptors).not.toContainEqual(expect.objectContaining({ invocation: "subagent" }));
    expect(staleDescriptors).toContainEqual(
      { tool: "codex", invocation: "local-cli", role: "evaluator", model_family: "codex" }
    );
    // With only one family left, the UI can no longer seed a signable pair.
    expect(initialNonFastBindingsForProfile(STALE_BRIDGE_CATALOG as never, "heterogeneous")).toBeNull();
    expect(initialNonFastBindingsForProfile(UNPROVED_BRIDGE_CATALOG as never, "heterogeneous")).toBeNull();
  });

  it("offers the proved bridge as a selectable invocation in the dynamic role editor", () => {
    const html = renderToStaticMarkup(createElement(ModeEditor, {
      projectId: "project-f004",
      tools: PROVED_BRIDGE_CATALOG as never,
      integrations: [bridgeIntegration()] as never,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
      blocker: null,
      selectedRole: "generator",
      currentRoleBinding: null,
      pendingRoleBinding: null,
      currentIntent: null
    }));
    // Both routes are offered as tool choices in the dynamic role selector.
    expect(html).toContain('<option value="kimi">');
    expect(html).toContain('<option value="codex">');
    // The bridge is reachable as an invocation and is labelled as a bridge.
    expect(html).toContain('value="subagent"');
    expect(html).toContain('value="local-cli"');
    expect(html).toContain("invocationMode.sameSessionBridge");
  });

  it("hides an unproved bridge from the same editor", () => {
    const html = renderToStaticMarkup(createElement(ModeEditor, {
      projectId: "project-f004",
      tools: UNPROVED_BRIDGE_CATALOG as never,
      integrations: [bridgeIntegration()] as never,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
      blocker: null,
      selectedRole: "generator",
      currentRoleBinding: null,
      pendingRoleBinding: null,
      currentIntent: null
    }));
    expect(html).not.toContain('<option value="kimi">');
    expect(html).not.toContain('value="subagent"');
    expect(html).toContain('<option value="codex">');
  });
});

describe("F004 (c) Coordinator-host-native and bridge wording are distinguishable", () => {
  it("labels a proved same-session bridge differently from a host-native child", () => {
    const bridgeHtml = renderToStaticMarkup(createElement(ModeEditor, {
      projectId: "project-f004",
      tools: PROVED_BRIDGE_CATALOG as never,
      integrations: [bridgeIntegration()] as never,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
      blocker: null,
      selectedRole: "generator",
      currentRoleBinding: null,
      pendingRoleBinding: null,
      currentIntent: null
    }));
    expect(bridgeHtml).toContain("invocationMode.sameSessionBridge(kind=session-bridge-v1)");
    expect(bridgeHtml).not.toContain("invocationMode.hostNative");

    const hostNativeHtml = renderToStaticMarkup(createElement(ModeEditor, {
      projectId: "project-f004",
      tools: PROVED_BRIDGE_CATALOG as never,
      integrations: [{
        ...bridgeIntegration(),
        bridgeId: null,
        bridgeKind: null,
        sessionScope: null
      }] as never,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
      blocker: null,
      selectedRole: "generator",
      currentRoleBinding: null,
      pendingRoleBinding: null,
      currentIntent: null
    }));
    expect(hostNativeHtml).toContain("invocationMode.hostNative");
    expect(hostNativeHtml).not.toContain("invocationMode.sameSessionBridge");
  });

  it("ships both wordings in both locales with identical placeholders", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as any;
    const zh = JSON.parse(readFileSync("messages/zh-CN.json", "utf8")) as any;
    for (const messages of [en, zh]) {
      const editor = messages.harness.editor.invocationMode;
      const integration = messages.harness.detail.modes.integration;
      expect(typeof editor.hostNative).toBe("string");
      expect(typeof editor.sameSessionBridge).toBe("string");
      expect(editor.hostNative).not.toBe(editor.sameSessionBridge);
      expect(editor.sameSessionBridge).toContain("{kind}");
      expect(typeof integration.hostNative).toBe("string");
      expect(typeof integration.sameSessionBridge).toBe("string");
      expect(integration.hostNative).not.toBe(integration.sameSessionBridge);
    }
    expect(en.harness.editor.invocationMode.hostNative).not.toBe(
      zh.harness.editor.invocationMode.hostNative
    );
  });
});

function bridgeIntegration() {
  return {
    id: "kimi",
    tool: "kimi",
    label: "kimi label",
    modelFamily: "kimi",
    roles: ["planner", "generator", "evaluator"],
    invocations: ["local-cli", "subagent"],
    capabilities: ["plan", "build", "verify"],
    localCli: true,
    subagent: true,
    bridgeId: "kimi-acp-native-agent",
    bridgeKind: "session-bridge-v1",
    sessionScope: "same-session",
    bridgeProtocol: "acp-native-agent/v1",
    bridgeCommand: ["kimi", "acp"],
    adapterBridgeCommand: ["kimi", "acp"],
    bridgeRoles: ["planner", "generator", "evaluator"],
    a2aTargetCount: 0,
    sandboxed: true
  };
}

function bridgeSnapshot(proof: ReturnType<typeof liveProof>) {
  return {
    framework: {
      version: "1.5.3",
      commit: HEAD,
      adopted: true,
      managedCount: 120,
      drift: { ok: 120, modified: 0, missing: 0, customized: 0 },
      scanned: true
    },
    execution: "heterogeneous",
    autonomy: { enabled: false, policyValid: null, authorizedBy: null, expiresAt: null, status: null },
    dispatch: {
      enabled: true,
      assignments: {},
      integrations: [
        bridgeIntegration(),
        {
          id: "codex",
          tool: "codex",
          label: "codex label",
          modelFamily: "codex",
          roles: ["planner", "generator", "evaluator"],
          invocations: ["local-cli"],
          capabilities: ["plan", "build", "verify"],
          localCli: true,
          subagent: false,
          bridgeId: null,
          bridgeKind: null,
          sessionScope: null,
          a2aTargetCount: 0,
          sandboxed: true
        }
      ],
      toolCatalog: PROVED_BRIDGE_CATALOG.map((entry) =>
        entry.invocation === "subagent" ? { ...entry, subagentProvider: proof } : { ...entry }
      ),
      familyExclusive: true,
      issues: []
    },
    gate: { pubInstalled: true, guardMode: "signature", pendingGateId: null },
    machinery: { denyListMerged: true, hooks: ["dispatch"], missing: [] },
    pendingDefaults: null
  } as Record<string, unknown>;
}
