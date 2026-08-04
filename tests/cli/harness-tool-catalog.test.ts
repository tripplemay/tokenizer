import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: execFileSyncMock
}));

import {
  readDispatchToolCatalog,
  readDispatchToolIntegrations,
  readDispatchToolInventory
} from "@/cli/harness-tool-catalog";

let repo: string;

function write(rel: string, value: unknown): string {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  return path;
}

const PROVIDER_DIGEST = "a".repeat(64);
const providerTest = process.platform === "win32" ? it.skip : it;
const VM_PROVIDER_TEMPLATE = "framework/templates/claude/dispatch/transports/vm-bridge-provider.py";
const VM_RUNTIME_FILES = [
  "vm-bridge-provider.py",
  "session-bridge.py",
  "session_bridge_kimi.py",
  "vm-bridge-worker.py"
] as const;
const KIMI_NATIVE_AGENT_TYPES = {
  planner: "plan",
  generator: "coder",
  evaluator: "explore"
};
const KIMI_ACP_BRIDGE_TEMPLATE =
  "framework/templates/claude/dispatch/transports/bridges/kimi-acp-native-agent.json";

function vmProviderResponse(options: {
  available?: boolean;
  provider?: Record<string, unknown>;
  attestation?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  return {
    available: options.available ?? true,
    provider: {
      id: "harness-vm-v1",
      kind: "vm-v1",
      contract_sha256: PROVIDER_DIGEST,
      ...options.provider
    },
    attestation: {
      version: "harness/external-bridge-provider-attestation/1",
      provider_id: "harness-vm-v1",
      provider_kind: "vm-v1",
      contract_sha256: PROVIDER_DIGEST,
      phase: "catalog",
      nonce_sha256: "b".repeat(64),
      issued_at: issuedAt,
      expires_at: expiresAt,
      image_sha256: "c".repeat(64),
      runner_sha256: "d".repeat(64),
      cli_bundle_sha256: "e".repeat(64),
      broker_policy_sha256: "f".repeat(64),
      ...options.attestation
    }
  };
}

function writeBundledVmBridgeProvider(): void {
  for (const filename of VM_RUNTIME_FILES) {
    write(
      ".claude/dispatch/transports/" + filename,
      readFileSync(join(process.cwd(), "framework/templates/claude/dispatch/transports", filename), "utf8")
    );
  }
}

/** Simulates a project-controlled provider plus its self-authored lock. */
function writeUntrustedVmBridgeProvider(response: unknown): void {
  for (const filename of VM_RUNTIME_FILES.filter((filename) => filename !== "vm-bridge-provider.py")) {
    write(
      ".claude/dispatch/transports/" + filename,
      readFileSync(join(process.cwd(), "framework/templates/claude/dispatch/transports", filename), "utf8")
    );
  }
  const body = `import sys\nsys.stdout.write(${JSON.stringify(JSON.stringify(response))})\n`;
  const path = write(".claude/dispatch/transports/vm-bridge-provider.py", body);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  write("harness.lock", {
    lock_version: 1,
    managed: {
      ".claude/dispatch/transports/vm-bridge-provider.py": {
        src: "templates/claude/dispatch/transports/vm-bridge-provider.py",
        sha256,
        upstream: sha256
      }
    }
  });
}

function writeKimiAcpBridge(
  protocolKind = "acp-native-agent/v1",
  command: string[] = ["kimi", "acp"]
): void {
  write(".claude/dispatch/transports/bridges/kimi-acp-native-agent.json", {
    id: "kimi-acp-native-agent",
    _verified: true,
    session_scope: "same-session",
    strategy: "session-bridge-v1",
    protocol: {
      kind: protocolKind,
      command,
      request_delivery: "stdin",
      response_format: "json"
    },
    personas: {
      planner: "planner-proposal",
      generator: "generator-restricted",
      evaluator: "evaluator"
    },
    native_agent_types: KIMI_NATIVE_AGENT_TYPES
  });
}

function writeKimiExternalIntegration(): void {
  write(".agents-registry.json", {
    version: "tool-integrations/1",
    integrations: [{
      id: "kimi",
      tool: "kimi",
      label: "Kimi Code",
      model_family: "kimi",
      subagent: { bridge: "kimi-acp-native-agent" },
      local_cli: {
        adapter: "kimi",
        sandbox: { home_dir: "~/.harness-sandbox/kimi" },
        timeout_s: 1800
      }
    }],
    a2a_targets: []
  });
}

function installCatalogFixture(): void {
  write(".agents-registry.json", {
    version: "dispatch/1",
    agents: [
      {
        id: "planner-claude",
        roles: ["planner"],
        transport: "subagent",
        agent_type: "planner-proposal",
        model_family: "claude",
        capabilities: ["plan"]
      },
      {
        id: "builder-future",
        roles: ["generator"],
        transport: "local-cli",
        adapter: "future-cli",
        model_family: "future",
        sandbox: {
          home_dir: "~/future",
          env_allow: ["FUTURE_CLI_TOKEN"],
          env_set: { FUTURE_CLI_HOME: "~/.future" }
        },
        constraints: { l2: false, write_src: true, push: false },
        capabilities: ["build"]
      },
      {
        id: "reviewer-kimi",
        roles: ["evaluator"],
        transport: "local-cli",
        adapter: "kimi",
        model_family: "kimi",
        sandbox: { home_dir: "~/kimi" },
        capabilities: ["verify"]
      },
      {
        id: "reviewer-remote",
        roles: ["evaluator"],
        transport: "a2a",
        endpoint: "https://example.invalid/a2a",
        model_family: "remote",
        auth: { type: "bearer", env: "REMOTE_A2A_TOKEN" },
        capabilities: ["verify"]
      },
      {
        id: "planner-kimi",
        roles: ["planner"],
        transport: "local-cli",
        adapter: "kimi",
        model_family: "kimi",
        sandbox: { home_dir: "~/planner-kimi" },
        constraints: { l2: false, write_src: false, push: false },
        capabilities: ["plan"]
      }
    ]
  });
  write(".claude/dispatch/transports/adapters/future-cli.json", {
    name: "future-cli",
    tool: "future-cli",
    display_name: "Future CLI",
    model_family: "future",
    argv: ["future-cli"],
    envelope_delivery: "env",
    env_allowlist_extra: ["FUTURE_CLI_TOKEN"],
    bridge_commands: { "acp-native-agent/v1": ["future-cli", "acp"] },
    _verified: true
  });
  write(".claude/dispatch/transports/adapters/kimi.json", {
    name: "kimi",
    tool: "kimi",
    display_name: "Kimi",
    model_family: "kimi",
    argv: ["kimi"],
    envelope_delivery: "stdin",
    env_allowlist_extra: ["KIMI_CODE_HOME"],
    bridge_commands: { "acp-native-agent/v1": ["kimi", "acp"] },
    _verified: true
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "tool-catalog-"));
  installCatalogFixture();
  execFileSyncMock.mockReset();
});

afterEach(() => {
  execFileSyncMock.mockReset();
  rmSync(repo, { recursive: true, force: true });
});

function withPlatform<T>(platform: NodeJS.Platform, action: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  if (!original) throw new Error("process.platform descriptor is unavailable");
  Object.defineProperty(process, "platform", { ...original, value: platform });
  try {
    return action();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

describe("data-only dispatch tool catalog", () => {
  it("keeps Kimi and Codex local-cli while a declared bridge has no strict provider", () => {
    write(".claude/dispatch/transports/bridges/kimi-acp-native-agent.json", {
      _comment: "Verified same-session Kimi bridge.",
      id: "kimi-acp-native-agent",
      _verified: true,
      session_scope: "same-session",
      strategy: "session-bridge-v1",
      protocol: {
        kind: "acp-native-agent/v1",
        command: ["kimi", "acp"],
        request_delivery: "stdin",
        response_format: "json"
      },
      personas: {
        planner: "planner-proposal",
        generator: "generator-restricted",
        evaluator: "evaluator"
      },
      native_agent_types: KIMI_NATIVE_AGENT_TYPES,
      notes: "Uses the integration local_cli sandbox and timeout."
    });
    write(".claude/dispatch/transports/adapters/codex.json", {
      name: "codex",
      tool: "codex",
      display_name: "Codex",
      model_family: "codex",
      argv: ["codex"],
      envelope_delivery: "stdin",
      _verified: true
    });
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [
        {
          id: "codex",
          tool: "codex",
          label: "Codex",
          model_family: "codex",
          local_cli: {
            adapter: "codex",
            sandbox: { home_dir: "~/.harness-sandbox/codex" },
            timeout_s: 2400
          }
        },
        {
          id: "kimi",
          tool: "kimi",
          label: "Kimi Code",
          model_family: "kimi",
          subagent: { bridge: "kimi-acp-native-agent" },
          local_cli: {
            adapter: "kimi",
            sandbox: { home_dir: "~/.harness-sandbox/kimi" },
            timeout_s: 1800
          }
        }
      ],
      a2a_targets: []
    });

    expect(readDispatchToolCatalog(repo)).toMatchObject({
      issue: null,
      entries: expect.arrayContaining([
        expect.objectContaining({ role: "generator", tool: "codex", invocation: "local-cli" }),
        expect.objectContaining({ role: "evaluator", tool: "kimi", invocation: "local-cli" })
      ])
    });
    expect(readDispatchToolCatalog(repo).entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ invocation: "subagent" })
    ]));
    expect(readDispatchToolIntegrations(repo)).toMatchObject({
      issue: null,
      integrations: expect.arrayContaining([
        expect.objectContaining({
          id: "codex",
          invocations: ["local-cli"],
          subagent: false,
          bridgeId: null,
          bridgeKind: null,
          sessionScope: null
        }),
        expect.objectContaining({
          id: "kimi",
          invocations: ["local-cli"],
          subagent: false,
          bridgeId: null,
          bridgeKind: null,
          sessionScope: null,
          bridgeProtocol: null,
          bridgeCommand: null,
          adapterBridgeCommand: null,
          bridgeRoles: null
        })
      ])
    });
  });

  providerTest("publishes an external bridge only from one live framework-provider attestation", () => {
    writeKimiAcpBridge();
    writeKimiExternalIntegration();
    writeBundledVmBridgeProvider();
    execFileSyncMock.mockReturnValue(JSON.stringify(vmProviderResponse()));

    const inventory = readDispatchToolInventory(repo);
    expect(inventory.catalog.issue).toBeNull();
    expect(inventory.catalog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: "kimi",
        invocation: "subagent",
        role: "planner",
        subagentProvider: expect.objectContaining({
          id: "harness-vm-v1",
          kind: "vm-v1",
          contractSha256: PROVIDER_DIGEST,
          attestation: expect.objectContaining({ phase: "catalog" })
        })
      }),
      expect.objectContaining({ tool: "kimi", invocation: "subagent", role: "generator" }),
      expect.objectContaining({ tool: "kimi", invocation: "subagent", role: "evaluator" })
    ]));
    expect(inventory.integrations).toMatchObject({
      issue: null,
      integrations: [expect.objectContaining({
        id: "kimi",
        invocations: ["local-cli", "subagent"],
        subagent: true,
        subagentProvider: expect.objectContaining({ id: "harness-vm-v1" })
      })]
    });
    const [command, args] = execFileSyncMock.mock.calls[0] ?? [];
    expect(command).toBe("/usr/bin/python3");
    expect(args).toEqual([
      "-I",
      join(process.cwd(), VM_PROVIDER_TEMPLATE),
      "catalog-attest"
    ]);
  });

  it("accepts the framework Kimi ACP native agent-type mapping", () => {
    write(
      ".claude/dispatch/transports/bridges/kimi-acp-native-agent.json",
      readFileSync(join(process.cwd(), KIMI_ACP_BRIDGE_TEMPLATE), "utf8")
    );
    writeKimiExternalIntegration();

    expect(readDispatchToolCatalog(repo)).toMatchObject({
      issue: null,
      entries: expect.arrayContaining([
        expect.objectContaining({ tool: "kimi", invocation: "local-cli", role: "planner" }),
        expect.objectContaining({ tool: "kimi", invocation: "local-cli", role: "generator" }),
        expect.objectContaining({ tool: "kimi", invocation: "local-cli", role: "evaluator" })
      ])
    });
  });

  providerTest("fails closed for a project provider and self-authored lock even when it prints a valid attestation", () => {
    writeKimiAcpBridge();
    writeKimiExternalIntegration();
    writeUntrustedVmBridgeProvider(vmProviderResponse());

    const catalog = readDispatchToolCatalog(repo);
    expect(catalog.issue).toBeNull();
    expect(catalog.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "kimi", invocation: "subagent" })
    ]));
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  providerTest("fails closed when a project VM runner diverges from the app-owned bundle", () => {
    writeKimiAcpBridge();
    writeKimiExternalIntegration();
    writeBundledVmBridgeProvider();
    write(".claude/dispatch/transports/vm-bridge-worker.py", "raise SystemExit('project drift')\n");
    execFileSyncMock.mockReturnValue(JSON.stringify(vmProviderResponse()));

    expect(readDispatchToolCatalog(repo).entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "kimi", invocation: "subagent" })
    ]));
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  providerTest.each([
    ["expired", vmProviderResponse({ attestation: { expires_at: new Date(Date.now() - 1_000).toISOString() } })],
    ["issued time beyond clock skew", vmProviderResponse({ attestation: {
      issued_at: new Date(Date.now() + 31_000).toISOString(),
      expires_at: new Date(Date.now() + 151_000).toISOString()
    } })],
    ["TTL beyond five minutes", vmProviderResponse({ attestation: {
      issued_at: new Date(Date.now() - 1_000).toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1_000).toISOString()
    } })],
    ["provider identity mismatch", vmProviderResponse({ provider: { id: "forged-vm" } })],
    ["contract mismatch", vmProviderResponse({ attestation: { contract_sha256: "0".repeat(64) } })],
    ["upper-case digest", vmProviderResponse({ attestation: { runner_sha256: "D".repeat(64) } })]
  ])("fails closed for a %s provider attestation", (_label, response) => {
    writeKimiAcpBridge();
    writeKimiExternalIntegration();
    writeBundledVmBridgeProvider();
    execFileSyncMock.mockReturnValue(JSON.stringify(response));

    const inventory = readDispatchToolInventory(repo);
    expect(inventory.catalog.issue).toBeNull();
    expect(inventory.catalog.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "kimi", invocation: "subagent" })
    ]));
    expect(inventory.integrations.integrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "kimi", invocations: ["local-cli"], subagent: false })
    ]));
  });

  providerTest("does not inherit an environment-selected provider decision", () => {
    writeKimiAcpBridge();
    writeKimiExternalIntegration();
    writeBundledVmBridgeProvider();
    execFileSyncMock.mockReturnValue(JSON.stringify(vmProviderResponse()));
    const original = process.env.TOKENIZER_TEST_PROVIDER;
    process.env.TOKENIZER_TEST_PROVIDER = "enabled";
    try {
      expect(readDispatchToolCatalog(repo).entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ tool: "kimi", invocation: "subagent" })
      ]));
      const options = execFileSyncMock.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
      expect(options?.env).not.toHaveProperty("TOKENIZER_TEST_PROVIDER");
    } finally {
      if (original === undefined) delete process.env.TOKENIZER_TEST_PROVIDER;
      else process.env.TOKENIZER_TEST_PROVIDER = original;
    }
  });

  it.each(["codex-app-server-session-fork/v1", "unpublished-native-agent/v1"])(
    "fails closed for unsupported external bridge protocol %s",
    (protocolKind) => {
      writeKimiAcpBridge(protocolKind);
      writeKimiExternalIntegration();

      expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
    }
  );

  it.each([
    ["missing native agent types", (bridge: Record<string, unknown>) => {
      delete bridge.native_agent_types;
    }],
    ["native types missing a persona role", (bridge: Record<string, unknown>) => {
      bridge.native_agent_types = { planner: "plan", evaluator: "explore" };
    }],
    ["native types declaring an extra role", (bridge: Record<string, unknown>) => {
      bridge.personas = { planner: "planner-proposal" };
      bridge.native_agent_types = { planner: "plan", generator: "coder" };
    }],
    ["unknown native agent type", (bridge: Record<string, unknown>) => {
      bridge.native_agent_types = { ...KIMI_NATIVE_AGENT_TYPES, planner: "reviewer" };
    }],
    ["non-string native agent type", (bridge: Record<string, unknown>) => {
      bridge.native_agent_types = { ...KIMI_NATIVE_AGENT_TYPES, planner: 1 };
    }],
    ["unknown deliverable channel", (bridge: Record<string, unknown>) => {
      bridge.deliverable_channels = { planner: "carrier-pigeon" };
    }],
    ["deliverable channel for an undeclared role", (bridge: Record<string, unknown>) => {
      bridge.personas = { planner: "planner-proposal" };
      bridge.native_agent_types = { planner: "plan" };
      bridge.deliverable_channels = { evaluator: "file" };
    }],
    ["non-object deliverable channels", (bridge: Record<string, unknown>) => {
      bridge.deliverable_channels = "terminal-message";
    }]
  ])("fails closed for %s", (_label, mutate) => {
    writeKimiAcpBridge();
    const bridge = JSON.parse(readFileSync(
      join(repo, ".claude/dispatch/transports/bridges/kimi-acp-native-agent.json"),
      "utf8"
    )) as Record<string, unknown>;
    mutate(bridge);
    write(".claude/dispatch/transports/bridges/kimi-acp-native-agent.json", bridge);
    writeKimiExternalIntegration();

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("accepts a manifest declaring a terminal-message deliverable channel (FIX2 #1:A)", () => {
    writeKimiAcpBridge();
    const bridge = JSON.parse(readFileSync(
      join(repo, ".claude/dispatch/transports/bridges/kimi-acp-native-agent.json"),
      "utf8"
    )) as Record<string, unknown>;
    bridge.deliverable_channels = { planner: "terminal-message" };
    write(".claude/dispatch/transports/bridges/kimi-acp-native-agent.json", bridge);
    writeKimiExternalIntegration();

    const catalog = readDispatchToolCatalog(repo);
    expect(catalog.issue).toBeNull();
  });

  it("fails closed when an ACP bridge command differs from its verified adapter declaration", () => {
    writeKimiAcpBridge("acp-native-agent/v1", ["kimi", "acp", "--child"]);
    writeKimiExternalIntegration();

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("fails closed when an external bridge adapter omits its published ACP command", () => {
    writeKimiAcpBridge();
    const adapter = JSON.parse(readFileSync(join(repo, ".claude/dispatch/transports/adapters/kimi.json"), "utf8")) as Record<string, unknown>;
    delete adapter.bridge_commands;
    write(".claude/dispatch/transports/adapters/kimi.json", adapter);
    writeKimiExternalIntegration();

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("fails closed when an adapter bridge command does not begin with its executable and acp", () => {
    writeKimiAcpBridge();
    const adapter = JSON.parse(readFileSync(join(repo, ".claude/dispatch/transports/adapters/kimi.json"), "utf8")) as Record<string, unknown>;
    adapter.bridge_commands = { "acp-native-agent/v1": ["other-cli", "acp"] };
    write(".claude/dispatch/transports/adapters/kimi.json", adapter);
    writeKimiExternalIntegration();

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("fails closed when an adapter advertises an unrecognized bridge command protocol", () => {
    writeKimiAcpBridge();
    const adapter = JSON.parse(readFileSync(join(repo, ".claude/dispatch/transports/adapters/kimi.json"), "utf8")) as Record<string, unknown>;
    adapter.bridge_commands = { "unpublished-native-agent/v1": ["kimi", "acp"] };
    write(".claude/dispatch/transports/adapters/kimi.json", adapter);
    writeKimiExternalIntegration();

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("keeps a future CLI local-only until a strict provider is released", () => {
    write(".claude/dispatch/transports/bridges/future-generator-only.json", {
      id: "future-generator-only",
      _verified: true,
      session_scope: "same-session",
      strategy: "session-bridge-v1",
      protocol: {
        kind: "acp-native-agent/v1",
        command: ["future-cli", "acp"],
        request_delivery: "stdin",
        response_format: "json"
      },
      personas: { generator: "generator-restricted" },
      native_agent_types: { generator: "coder" }
    });
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [{
        id: "future-bridge",
        tool: "future-cli",
        label: "Future CLI",
        model_family: "future",
        subagent: { bridge: "future-generator-only" },
        local_cli: {
          adapter: "future-cli",
          sandbox: { home_dir: "~/.harness-sandbox/future" },
          timeout_s: 2400
        }
      }],
      a2a_targets: []
    });

    const catalog = readDispatchToolCatalog(repo);
    expect(catalog.issue).toBeNull();
    expect(catalog.entries.filter((entry) => entry.tool === "future-cli" && entry.invocation === "subagent"))
      .toEqual([]);
    expect(catalog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "future-cli", invocation: "local-cli", role: "generator" })
    ]));
  });

  it("does not fall back to a user-facing example registry", () => {
    unlinkSync(join(repo, ".agents-registry.json"));
    write(".claude/dispatch/agents-registry.example.json", {
      version: "dispatch/1",
      agents: [{
        id: "example-only",
        roles: ["planner"],
        transport: "subagent",
        agent_type: "planner-proposal",
        model_family: "example"
      }]
    });

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
    expect(readDispatchToolIntegrations(repo)).toEqual({ integrations: [], issue: "dispatch tool catalog is unavailable" });
  });

  it.each([
    ["unknown bridge", { bridge: "missing-bridge" }],
    ["legacy false", false],
    ["missing bridge key", {}]
  ])("fails closed for %s subagent declaration", (_label, subagent) => {
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [{
        id: "future-bridge",
        tool: "future-cli",
        model_family: "future",
        subagent
      }],
      a2a_targets: []
    });
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("fails closed when an external bridge omits its verified local-cli contract", () => {
    write(".claude/dispatch/transports/bridges/kimi-acp-native-agent.json", {
      id: "kimi-acp-native-agent",
      _verified: true,
      session_scope: "same-session",
      strategy: "session-bridge-v1",
      protocol: {
        kind: "acp-native-agent/v1",
        command: ["kimi", "acp"],
        request_delivery: "stdin",
        response_format: "json"
      },
      personas: {
        planner: "planner-proposal",
        generator: "generator-restricted",
        evaluator: "evaluator"
      },
      native_agent_types: KIMI_NATIVE_AGENT_TYPES
    });
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [{
        id: "kimi-bridge",
        tool: "kimi",
        model_family: "kimi",
        subagent: { bridge: "kimi-acp-native-agent" }
      }],
      a2a_targets: []
    });
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("does not publish an external bridge even when the reported host is darwin", () => {
    writeKimiAcpBridge();
    writeKimiExternalIntegration();

    const { catalog, integrations } = withPlatform("darwin", () => ({
      catalog: readDispatchToolCatalog(repo),
      integrations: readDispatchToolIntegrations(repo)
    }));

    expect(catalog).toMatchObject({ issue: null });
    expect(catalog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "planner", tool: "kimi", invocation: "local-cli" })
    ]));
    expect(catalog.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "kimi", invocation: "subagent" })
    ]));
    expect(integrations).toMatchObject({
      issue: null,
      integrations: [expect.objectContaining({
        id: "kimi",
        invocations: ["local-cli"],
        subagent: false,
        bridgeId: null,
        bridgeKind: null,
        sessionScope: null,
        bridgeProtocol: null,
        bridgeCommand: null,
        adapterBridgeCommand: null,
        bridgeRoles: null
      })]
    });
  });

  it("rejects a malformed bridge before the strict-provider gate", () => {
    writeKimiAcpBridge("unpublished-native-agent/v1");
    writeKimiExternalIntegration();

    const catalog = withPlatform("darwin", () => readDispatchToolCatalog(repo));
    expect(catalog).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("keeps legacy Coordinator-native metadata out of selectable tool inventory", () => {
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [
        {
          id: "claude-subagent",
          tool: "claude-code",
          label: "Claude Code",
          model_family: "claude",
          priority: 100,
          capabilities: ["plan", "build", "verify"],
          subagent: true
        }
      ],
      a2a_targets: []
    });

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: null });
    expect(readDispatchToolIntegrations(repo)).toEqual({ integrations: [], issue: null });

    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [
        {
          id: "claude-subagent",
          tool: "claude-code",
          label: "Claude Code",
          model_family: "claude",
          priority: 100,
          capabilities: ["plan", "build", "verify"],
          subagent: true
        }
      ],
      a2a_targets: [
        {
          id: "invalid-remote",
          integration_id: "claude-subagent",
          endpoint: "https://example.invalid/a2a",
          remote_runner_id: "invalid-runner",
          priority: 100,
          auth: { type: "none" }
        }
      ]
    });
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("keeps dispatch/1 Coordinator-native subagents observable but out of the v2 catalog", () => {
    const catalog = readDispatchToolCatalog(repo);
    const integrations = readDispatchToolIntegrations(repo);

    expect(catalog.issue).toBeNull();
    expect(catalog.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ invocation: "subagent" })
    ]));
    expect(integrations).toMatchObject({
      issue: null,
      integrations: expect.arrayContaining([
        expect.objectContaining({
          id: "planner-claude",
          tool: "claude-code",
          invocations: ["subagent"],
          subagent: true,
          bridgeId: null,
          bridgeKind: null,
          sessionScope: null
        })
      ])
    });
  });

  it("rejects duplicate integration ids even when a legacy declaration has no public route", () => {
    write(".claude/dispatch/transports/adapters/codex.json", {
      name: "codex",
      tool: "codex",
      display_name: "Codex",
      model_family: "codex",
      argv: ["codex"],
      envelope_delivery: "stdin",
      _verified: true
    });
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [
        {
          id: "codex",
          tool: "codex",
          model_family: "codex",
          subagent: true
        },
        {
          id: "codex",
          tool: "codex",
          model_family: "codex",
          local_cli: {
            adapter: "codex",
            sandbox: { home_dir: "~/.harness-sandbox/codex" }
          }
        }
      ],
      a2a_targets: []
    });
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("mirrors framework defaults and merges integration capabilities into A2A routes", () => {
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [
        {
          id: "future-defaults",
          tool: "future-cli",
          model_family: "future",
          local_cli: {
            adapter: "future-cli",
            sandbox: { home_dir: "~/.harness-sandbox/future" }
          }
        },
        {
          id: "kimi-remote",
          tool: "kimi",
          label: "Kimi",
          model_family: "kimi",
          capabilities: ["plan"],
          local_cli: {
            adapter: "kimi",
            sandbox: { home_dir: "~/.harness-sandbox/kimi" }
          }
        }
      ],
      a2a_targets: [
        {
          id: "kimi-remote-target",
          integration_id: "kimi-remote",
          endpoint: "https://example.invalid/a2a",
          remote_runner_id: "kimi-runner"
        }
      ]
    });

    const catalog = readDispatchToolCatalog(repo);
    expect(catalog.issue).toBeNull();
    expect(catalog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "generator",
        tool: "future-cli",
        label: "future-cli",
        invocation: "local-cli",
        capabilities: []
      }),
      expect.objectContaining({
        role: "planner",
        tool: "kimi",
        invocation: "a2a",
        capabilities: ["plan"]
      })
    ]));
    expect(readDispatchToolIntegrations(repo)).toMatchObject({
      issue: null,
      integrations: expect.arrayContaining([
        expect.objectContaining({
          id: "future-defaults",
          label: "future-cli",
          capabilities: [],
          localCli: true,
          sandboxed: true
        })
      ])
    });
  });

  it("requires the framework-owned a2a_targets array", () => {
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [
        {
          id: "claude-subagent",
          tool: "claude-code",
          model_family: "claude",
          subagent: true
        }
      ]
    });
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it.each([false, [], "not-a-profile", null])(
    "fails closed when a declared local_cli is not an object (%j)",
    (local_cli) => {
      write(".agents-registry.json", {
        version: "tool-integrations/1",
        integrations: [{
          id: "claude-subagent",
          tool: "claude-code",
          model_family: "claude",
          subagent: true,
          local_cli
        }],
        a2a_targets: []
      });
      expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
    }
  );

  it("uses framework-length tool ids for integrations and A2A targets", () => {
    const overlong = "x".repeat(65);
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [{
        id: overlong,
        tool: "claude-code",
        model_family: "claude",
        subagent: true
      }],
      a2a_targets: []
    });
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });

    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [{
        id: "future",
        tool: "future-cli",
        model_family: "future",
        local_cli: {
          adapter: "future-cli",
          sandbox: { home_dir: "~/.harness-sandbox/future" },
          timeout_s: 1800
        }
      }],
      a2a_targets: [{
        id: overlong,
        integration_id: "future",
        endpoint: "https://example.invalid/a2a",
        remote_runner_id: "future-runner"
      }]
    });
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("derives tool routes and integration cards from tool-integrations/1 without exposing A2A target ids", () => {
    write(".claude/dispatch/transports/adapters/codex.json", {
      name: "codex",
      tool: "codex",
      display_name: "Codex",
      model_family: "codex",
      argv: ["codex"],
      envelope_delivery: "stdin",
      _verified: true
    });
    write(".claude/dispatch/transports/bridges/kimi-acp-native-agent.json", {
      id: "kimi-acp-native-agent",
      _verified: true,
      session_scope: "same-session",
      strategy: "session-bridge-v1",
      protocol: {
        kind: "acp-native-agent/v1",
        command: ["kimi", "acp"],
        request_delivery: "stdin",
        response_format: "json"
      },
      personas: {
        planner: "planner-proposal",
        generator: "generator-restricted",
        evaluator: "evaluator"
      },
      native_agent_types: KIMI_NATIVE_AGENT_TYPES
    });
    write(".agents-registry.json", {
      version: "tool-integrations/1",
      integrations: [
        {
          id: "codex-local",
          tool: "codex",
          label: "Codex CLI",
          model_family: "codex",
          priority: 100,
          capabilities: ["build", "verify"],
          local_cli: {
            adapter: "codex",
            sandbox: { home_dir: "~/.harness-sandbox/codex", env_set: { CODEX_HOME: "~/.codex" } },
            timeout_s: 2400
          }
        },
        {
          id: "kimi-local",
          tool: "kimi",
          label: "Kimi CLI",
          model_family: "kimi",
          priority: 110,
          capabilities: ["plan", "verify"],
          local_cli: {
            adapter: "kimi",
            sandbox: { home_dir: "~/.harness-sandbox/kimi" },
            timeout_s: 1800
          },
          subagent: { bridge: "kimi-acp-native-agent" }
        }
      ],
      a2a_targets: [
        {
          id: "codex-planner-remote",
          integration_id: "codex-local",
          endpoint: "https://example.invalid/a2a",
          remote_runner_id: "codex-runner-1",
          priority: 90,
          auth: { type: "bearer", env: "REMOTE_A2A_CODEX" },
          capabilities: ["plan", "verify"]
        }
      ]
    });

    const catalog = readDispatchToolCatalog(repo);
    const integrations = readDispatchToolIntegrations(repo);

    expect(catalog.issue).toBeNull();
    expect(catalog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "planner", tool: "codex", invocation: "local-cli" }),
      expect.objectContaining({ role: "planner", tool: "codex", invocation: "a2a" }),
      expect.objectContaining({ role: "generator", tool: "codex", invocation: "local-cli" }),
      expect.objectContaining({ role: "evaluator", tool: "codex", invocation: "a2a" }),
      expect.objectContaining({ role: "generator", tool: "kimi", invocation: "local-cli" })
    ]));
    expect(catalog.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "generator", tool: "codex", invocation: "a2a" })
    ]));
    expect(catalog.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "codex", invocation: "subagent" })
    ]));
    expect(integrations.issue).toBeNull();
    expect(integrations.integrations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "codex-local",
          tool: "codex",
          invocations: ["local-cli", "a2a"],
          a2aTargetCount: 1
        }),
        expect.objectContaining({
          id: "kimi-local",
          tool: "kimi",
          invocations: ["local-cli"],
          subagent: false,
          bridgeId: null,
          sessionScope: null
        })
      ]));
    const publicInventory = JSON.stringify(integrations);
    expect(publicInventory).not.toContain("codex-planner-remote");
    expect(publicInventory).not.toContain("codex-runner-1");
    expect(publicInventory).not.toContain("example.invalid/a2a");
  });

  it("discovers a compatible env-delivery adapter without executing repository helpers", () => {
    // A project may contain arbitrary code at this familiar path. The parser
    // does not inspect or run it; only registry and adapter data are consumed.
    write(".claude/dispatch/tool-catalog.py", "raise SystemExit('must not execute')\n");

    const catalog = readDispatchToolCatalog(repo);
    expect(catalog.issue).toBeNull();
    expect(catalog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "generator", tool: "future-cli", label: "Future CLI", invocation: "local-cli" }),
      expect.objectContaining({ role: "planner", tool: "kimi", label: "Kimi", invocation: "local-cli" })
    ]));
    expect(JSON.stringify(catalog.entries)).not.toContain("builder-future");
  });

  it("enforces bounded text and safe capability formats", () => {
    const makeRegistry = () => ({
      version: "tool-integrations/1",
      integrations: [{
        id: "future",
        tool: "future-cli",
        label: "Future CLI",
        model_family: "future",
        capabilities: ["build"],
        local_cli: {
          adapter: "future-cli",
          sandbox: { home_dir: "~/future" }
        }
      }],
      a2a_targets: [{
        id: "future-remote",
        integration_id: "future",
        endpoint: "https://example.invalid/a2a",
        remote_runner_id: "future-runner"
      }]
    });
    const cases: Array<[string, (registry: ReturnType<typeof makeRegistry>) => void]> = [
      ["model family length", (registry) => { registry.integrations[0].model_family = "x".repeat(129); }],
      ["model family control", (registry) => { registry.integrations[0].model_family = "future\nfamily"; }],
      ["model family edge control", (registry) => { registry.integrations[0].model_family = "\nfuture"; }],
      ["label length", (registry) => { registry.integrations[0].label = "x".repeat(129); }],
      ["label control", (registry) => { registry.integrations[0].label = "Future\nCLI"; }],
      ["capability format", (registry) => { registry.integrations[0].capabilities = ["unsafe capability"]; }],
      ["capability length", (registry) => { registry.integrations[0].capabilities = ["x".repeat(65)]; }],
      ["endpoint length", (registry) => { registry.a2a_targets[0].endpoint = `https://example.invalid/${"x".repeat(2025)}`; }],
      ["endpoint control", (registry) => { registry.a2a_targets[0].endpoint = "https://example.invalid/a2a\nnext"; }],
      ["endpoint edge control", (registry) => { registry.a2a_targets[0].endpoint = "\nhttps://example.invalid/a2a"; }]
    ];

    for (const [label, mutate] of cases) {
      const registry = makeRegistry();
      mutate(registry);
      write(".agents-registry.json", registry);
      expect(readDispatchToolCatalog(repo), label).toEqual({
        entries: [],
        issue: "dispatch tool catalog is unavailable"
      });
    }
  });

  it.each([
    ["registry", ".agents-registry.json", "registry-copy.json"],
    ["adapter", ".claude/dispatch/transports/adapters/future-cli.json", "adapter-copy.json"]
  ])("fails closed when the %s is symlinked", (_label, target, copy) => {
    const targetPath = join(repo, target);
    const copyPath = write(copy, readFileSync(targetPath, "utf8"));
    unlinkSync(targetPath);
    symlinkSync(copyPath, targetPath);

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it.each([
    ["a duplicate registry key", () => {
      write(".agents-registry.json", '{"version":"dispatch/1","version":"dispatch/1","agents":[]}');
    }],
    ["an unknown registry field", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.unexpected = true;
      write(".agents-registry.json", registry);
    }],
    ["an unknown descriptor field", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[0].unexpected = true;
      write(".agents-registry.json", registry);
    }],
    ["an unknown constraint field", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[1].constraints = { write_src: true, unexpected: true };
      write(".agents-registry.json", registry);
    }],
    ["an unknown adapter field", () => {
      const adapter = JSON.parse(readFileSync(join(repo, ".claude/dispatch/transports/adapters/future-cli.json"), "utf8"));
      adapter.unexpected = true;
      write(".claude/dispatch/transports/adapters/future-cli.json", adapter);
    }],
    ["an unsupported envelope delivery", () => {
      const adapter = JSON.parse(readFileSync(join(repo, ".claude/dispatch/transports/adapters/future-cli.json"), "utf8"));
      adapter.envelope_delivery = "pipe";
      write(".claude/dispatch/transports/adapters/future-cli.json", adapter);
    }]
  ])("fails closed for %s", (_label, corrupt) => {
    corrupt();
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it.each([
    ["an empty A2A auth block", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = {};
      write(".agents-registry.json", registry);
    }],
    ["a null A2A auth block", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = null;
      write(".agents-registry.json", registry);
    }],
    ["a bearer auth block without a credential environment key", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = { type: "bearer" };
      write(".agents-registry.json", registry);
    }],
    ["a bearer auth block with a protected credential environment key", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = { type: "bearer", env: "HARNESS_A2A_TOKEN" };
      write(".agents-registry.json", registry);
    }],
    ["a bearer auth block with a Git process-control key", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = { type: "bearer", env: "GIT_ASKPASS" };
      write(".agents-registry.json", registry);
    }],
    ["a bearer auth block that forwards an arbitrary host secret", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = { type: "bearer", env: "OPENAI_API_KEY" };
      write(".agents-registry.json", registry);
    }],
    ["a bearer auth block with a non-POSIX credential environment key", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = { type: "bearer", env: "1TOKEN" };
      write(".agents-registry.json", registry);
    }],
    ["a none auth block that still declares a credential environment key", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[3].auth = { type: "none", env: "REMOTE_A2A_TOKEN" };
      write(".agents-registry.json", registry);
    }],
    ["an auth block on a local CLI descriptor", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[1].auth = { type: "none" };
      write(".agents-registry.json", registry);
    }]
  ])("fails closed for %s", (_label, corrupt) => {
    corrupt();
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it.each([
    ["an adapter loader key", () => {
      const adapter = JSON.parse(readFileSync(join(repo, ".claude/dispatch/transports/adapters/future-cli.json"), "utf8"));
      adapter.env_allowlist_extra = ["LD_PRELOAD"];
      write(".claude/dispatch/transports/adapters/future-cli.json", adapter);
    }],
    ["a sandbox harness key", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[1].sandbox.env_allow = ["HARNESS_ARTIFACT"];
      write(".agents-registry.json", registry);
    }],
    ["a sandbox Git control key", () => {
      const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
      registry.agents[1].sandbox.env_set = { GIT_CONFIG_COUNT: "0" };
      write(".agents-registry.json", registry);
    }],
    ["a non-POSIX adapter key", () => {
      const adapter = JSON.parse(readFileSync(join(repo, ".claude/dispatch/transports/adapters/future-cli.json"), "utf8"));
      adapter.env_allowlist_extra = ["1NOT_A_KEY"];
      write(".claude/dispatch/transports/adapters/future-cli.json", adapter);
    }]
  ])("fails closed for %s", (_label, corrupt) => {
    corrupt();
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it("keeps tool-specific authentication homes eligible", () => {
    const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
    registry.agents[1].sandbox.env_allow = ["CODEX_HOME", "KIMI_CODE_HOME"];
    registry.agents[1].sandbox.env_set = {
      CODEX_HOME: "~/.codex",
      KIMI_CODE_HOME: "~/.kimi-code"
    };
    write(".agents-registry.json", registry);

    expect(readDispatchToolCatalog(repo).issue).toBeNull();
  });

  it("does not expose a local CLI whose dedicated home is relative at runtime", () => {
    const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
    registry.agents[1].sandbox.home_dir = "relative/future-home";
    write(".agents-registry.json", registry);

    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });

  it.each([
    ["omits constraints", undefined],
    ["sets constraints to null", null],
    ["omits l2", { write_src: true, push: false }],
    ["permits L2", { l2: true, write_src: true, push: false }],
    ["does not permit source writes", { l2: false, write_src: false, push: false }],
    ["permits push", { l2: false, write_src: true, push: true }]
  ])("fails closed when a local-cli Generator %s", (_label, constraints) => {
    const registry = JSON.parse(readFileSync(join(repo, ".agents-registry.json"), "utf8"));
    registry.agents[1].constraints = constraints;
    write(".agents-registry.json", registry);
    expect(readDispatchToolCatalog(repo)).toEqual({ entries: [], issue: "dispatch tool catalog is unavailable" });
  });
});
