import React, { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OwnedHarnessProjectDetail } from "@/server/harness-detail";
import type { HarnessDetailToolCapability } from "@/shared/harness-detail";
import { MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";

function translate(key: string, values?: Record<string, unknown>): string {
  if (key === "selectedRoleContext") return `Adjust ${values?.role} tool and invocation`;
  if (key === "candidateCount") return `${values?.count} eligible candidates`;
  return key;
}

Object.assign(translate, { has: () => true });

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => translate }));

import {
  isConfigurableModeRole,
  modeDrilldownHref,
  modeDrilldownTarget,
  modeEditorFocusRegion,
  modeEditorFocusTarget,
  modeEditorInitialProfile
} from "../../app/harness/[id]/mode-drilldown";
import { initialNonFastBindingsForProfile, ModeEditor } from "../../app/harness/[id]/mode-editor";
import { ModesAndAgentsView } from "../../app/harness/[id]/views";

const TOOLS: HarnessDetailToolCapability[] = [
  {
    role: "planner",
    tool: "claude-code",
    label: "Claude Code",
    invocation: "subagent",
    agentCount: 2,
    modelFamilies: ["claude"],
    capabilities: ["plan"]
  },
  {
    role: "planner",
    tool: "kimi",
    label: "Kimi",
    invocation: "local-cli",
    agentCount: 1,
    modelFamilies: ["kimi"],
    capabilities: ["plan"]
  },
  {
    role: "generator",
    tool: "codex",
    label: "Codex",
    invocation: "local-cli",
    agentCount: 1,
    modelFamilies: ["codex"],
    capabilities: ["build"]
  },
  {
    role: "evaluator",
    tool: "kimi",
    label: "Kimi",
    invocation: "local-cli",
    agentCount: 1,
    modelFamilies: ["kimi"],
    capabilities: ["verify"]
  }
];

const PROFILED_TOOLS: HarnessDetailToolCapability[] = [
  {
    role: "generator",
    tool: "claude-code",
    label: "Claude Code",
    invocation: "local-cli",
    agentCount: 1,
    modelFamilies: ["claude"],
    capabilities: ["build"]
  },
  {
    role: "evaluator",
    tool: "claude-code",
    label: "Claude Code",
    invocation: "a2a",
    agentCount: 1,
    modelFamilies: ["claude"],
    capabilities: ["verify"]
  },
  {
    role: "evaluator",
    tool: "codex",
    label: "Codex",
    invocation: "local-cli",
    agentCount: 1,
    modelFamilies: ["codex"],
    capabilities: ["verify"]
  },
  {
    role: "evaluator",
    tool: "codex",
    label: "Codex",
    invocation: "a2a",
    agentCount: 1,
    modelFamilies: ["codex"],
    capabilities: ["verify"]
  }
];

const BRIDGE_PROFILED_TOOLS: HarnessDetailToolCapability[] = [
  {
    role: "generator",
    tool: "kimi",
    label: "Kimi Code",
    invocation: "subagent",
    agentCount: 1,
    modelFamilies: ["kimi"],
    capabilities: ["build"]
  },
  {
    role: "evaluator",
    tool: "codex",
    label: "Codex",
    invocation: "local-cli",
    agentCount: 1,
    modelFamilies: ["codex"],
    capabilities: ["verify"]
  }
];

function project(): OwnedHarnessProjectDetail {
  return {
    id: "project-1",
    modes: {
      execution: "heterogeneous",
      autonomy: { enabled: false, policyValid: null, authorizedBy: null, expiresAt: null, status: null },
      dispatch: {
        enabled: true,
        assignments: { generator: "multi-role-agent", evaluator: "multi-role-agent" },
        agents: [
          {
            id: "multi-role-agent",
            roles: ["planner", "generator", "evaluator"],
            transport: "local-cli",
            modelFamily: "codex",
            adapter: "codex",
            sandboxed: true,
            capabilities: ["plan", "build", "verify"]
          }
        ],
        toolCatalog: TOOLS,
        familyExclusive: true,
        issues: []
      },
      framework: { version: "1.5.3", adopted: true, managedCount: 1, drift: { ok: 1, modified: 0, missing: 0, customized: 0 } },
      gate: { pubInstalled: true, guardMode: "signature", pendingGateId: null },
      machinery: { denyListMerged: true, hooks: [], missing: [] },
      pendingDefaults: null
    },
    modeIntents: [],
    reportedAt: new Date(),
    device: { agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION },
    headSha: "0123456789abcdef0123456789abcdef01234567"
  } as unknown as OwnedHarnessProjectDetail;
}

function nested(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  return path.reduce((value, key) => (value as Record<string, unknown>)[key] as Record<string, unknown>, root);
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nestedValue]) => leafPaths(nestedValue, prefix ? `${prefix}.${key}` : key));
}

describe("Harness mode drilldown contract", () => {
  it("uses a role-only query and editor anchor for each configurable role", () => {
    expect(modeDrilldownTarget("planner")).toBe("planner");
    expect(modeDrilldownTarget(["evaluator", "coordinator"])).toBe("evaluator");
    expect(modeDrilldownTarget("agent-123")).toBeNull();
    expect(isConfigurableModeRole("generator")).toBe(true);
    expect(isConfigurableModeRole("coordinator")).toBe(false);
    expect(modeDrilldownHref("project / 1", "planner")).toBe(
      "/harness/project%20%2F%201?view=modes&focus=planner#mode-editor"
    );
    expect(modeDrilldownHref("project-1", "coordinator")).toBe(
      "/harness/project-1?view=modes&focus=coordinator#coordinator-details"
    );
  });

  it("keeps the drilldown and selected-role locale keys symmetric", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>;
    const zh = JSON.parse(readFileSync("messages/zh-CN.json", "utf8")) as Record<string, unknown>;
    for (const path of [
      ["harness", "detail", "modes", "agent"],
      ["harness", "detail", "modes", "integration"],
      ["harness", "detail", "modes", "role"],
      ["harness", "detail", "modes", "coordinator"],
      ["harness", "editor"]
    ]) {
      const english = nested(en, path);
      const chinese = nested(zh, path);
      expect(leafPaths(english).sort()).toEqual(leafPaths(chinese).sort());
      expect(JSON.stringify(english).match(/\{[a-zA-Z]+\}/g)?.sort() ?? []).toEqual(
        JSON.stringify(chinese).match(/\{[a-zA-Z]+\}/g)?.sort() ?? []
      );
    }
  });

  it("renders distinct role entries for a multi-role agent without carrying its agent id in a configuration URL", async () => {
    const html = renderToStaticMarkup(await ModesAndAgentsView({
      project: project(),
      canSign: true,
      timezone: "UTC",
      selectedFocus: "planner"
    })).replaceAll("&amp;", "&");
    const drilldownHrefs = [...html.matchAll(/href="([^"]*focus=[^"]*)"/g)].map((match) => match[1]);

    expect(drilldownHrefs).toEqual(expect.arrayContaining([
      "/harness/project-1?view=modes&focus=planner#mode-editor",
      "/harness/project-1?view=modes&focus=generator#mode-editor",
      "/harness/project-1?view=modes&focus=evaluator#mode-editor",
      "/harness/project-1?view=modes&focus=coordinator#coordinator-details"
    ]));
    expect(drilldownHrefs.every((href) => !href.includes("multi-role-agent") && !href.includes("agent="))).toBe(true);
    expect(html).toContain('data-coordinator-readonly="true"');
  });

  it("renders Kimi's verified external bridge provenance while Codex remains a local route", async () => {
    const detail = project();
    (detail.modes as any).dispatch.integrations = [{
      id: "kimi-bridge",
      tool: "kimi",
      label: "Kimi Code",
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
    }];
    const html = renderToStaticMarkup(await ModesAndAgentsView({
      project: detail,
      canSign: true,
      timezone: "UTC",
      selectedFocus: null
    }));

    expect(html).toContain("kimi-acp-native-agent");
    expect(html).toContain("modes.integration.subagentPath");
    expect(html).toContain("modes.integration.sameSessionBridge");
  });

  it("starts a selected role in a configurable profile and renders its focusable tool route context", () => {
    expect(modeEditorInitialProfile("planner")).toBe("heterogeneous");
    expect(modeEditorInitialProfile(null)).toBe("fast");
    expect(modeEditorFocusTarget("planner")).toBe("mode-binding-planner-tool");
    expect(modeEditorFocusRegion("planner")).toBe("mode-binding-planner");

    const html = renderToStaticMarkup(createElement(ModeEditor, {
      projectId: "project-1",
      tools: TOOLS,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
      blocker: null,
      selectedRole: "planner",
      currentRoleBinding: { tool: "claude-code", invocation: "subagent", modelFamily: "claude" },
      pendingRoleBinding: { tool: "claude-code", invocation: "subagent" },
      currentIntent: null
    }));

    expect(html).toContain('id="mode-editor"');
    expect(html).toContain('id="mode-editor-role-context"');
    expect(html).toContain('id="mode-binding-planner-tool"');
    expect(html).toContain('data-selected-role="planner"');
    expect(html).toContain('aria-describedby="mode-editor-role-context"');
    expect(html).toContain("2 eligible candidates");
    expect(html).toContain("claude-code");
    expect(html).toContain("Kimi");
    expect(html).toContain("local-cli");
    expect(html).not.toContain("multi-role-agent");
  });

  it("chooses Coordinator plus a signable pair for each non-fast profile", () => {
    expect(initialNonFastBindingsForProfile(PROFILED_TOOLS, "heterogeneous")).toEqual({
      plannerTool: "",
      plannerInvocation: "",
      generatorTool: "claude-code",
      generatorInvocation: "local-cli",
      evaluatorTool: "codex",
      evaluatorInvocation: "local-cli"
    });
    expect(initialNonFastBindingsForProfile(PROFILED_TOOLS, "slow")).toEqual({
      plannerTool: "",
      plannerInvocation: "",
      generatorTool: "claude-code",
      generatorInvocation: "local-cli",
      evaluatorTool: "codex",
      evaluatorInvocation: "a2a"
    });
    expect(initialNonFastBindingsForProfile(BRIDGE_PROFILED_TOOLS, "heterogeneous")).toBeNull();
  });

  it("shows Coordinator only for an explicit null Planner audit value", () => {
    const unavailable = renderToStaticMarkup(createElement(ModeEditor, {
      projectId: "project-1",
      tools: TOOLS,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
      blocker: null,
      selectedRole: "planner",
      currentRoleBinding: undefined,
      pendingRoleBinding: undefined,
      currentIntent: null
    }));
    expect((unavailable.match(/notAvailable/g) ?? []).length).toBe(2);

    const coordinator = renderToStaticMarkup(createElement(ModeEditor, {
      projectId: "project-1",
      tools: TOOLS,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
      blocker: null,
      selectedRole: "planner",
      currentRoleBinding: null,
      pendingRoleBinding: null,
      currentIntent: null
    }));
    expect(coordinator).not.toContain("notAvailable");
    expect((coordinator.match(/coordinator/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
