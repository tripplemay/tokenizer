import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDispatchToolCatalog, readDispatchToolIntegrations } from "@/cli/harness-tool-catalog";

let repo: string;

function write(rel: string, value: unknown): string {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  return path;
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
    _verified: true
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "tool-catalog-"));
  installCatalogFixture();
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("data-only dispatch tool catalog", () => {
  it("accepts a subagent-only integration while requiring local-cli for A2A targets", () => {
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

    expect(readDispatchToolCatalog(repo)).toMatchObject({
      issue: null,
      entries: expect.arrayContaining([
        expect.objectContaining({ role: "planner", tool: "claude-code", invocation: "subagent" }),
        expect.objectContaining({ role: "generator", tool: "claude-code", invocation: "subagent" }),
        expect.objectContaining({ role: "evaluator", tool: "claude-code", invocation: "subagent" })
      ])
    });
    expect(readDispatchToolIntegrations(repo)).toMatchObject({
      issue: null,
      integrations: [expect.objectContaining({
        id: "claude-subagent",
        invocations: ["subagent"],
        localCli: false,
        sandboxed: false,
        a2aTargetCount: 0
      })]
    });

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
          },
          subagent: true
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
          }
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
      expect.objectContaining({ role: "planner", tool: "codex", invocation: "subagent" }),
      expect.objectContaining({ role: "planner", tool: "codex", invocation: "a2a" }),
      expect.objectContaining({ role: "generator", tool: "codex", invocation: "local-cli" }),
      expect.objectContaining({ role: "generator", tool: "codex", invocation: "subagent" }),
      expect.objectContaining({ role: "evaluator", tool: "codex", invocation: "a2a" })
    ]));
    expect(catalog.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "generator", tool: "codex", invocation: "a2a" })
    ]));
    expect(integrations.issue).toBeNull();
    expect(integrations.integrations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "codex-local",
          tool: "codex",
          invocations: ["local-cli", "subagent", "a2a"],
          a2aTargetCount: 1
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
