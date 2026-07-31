import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDispatchToolCatalog } from "@/cli/harness-tool-catalog";

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
