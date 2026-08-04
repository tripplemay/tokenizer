/**
 * F001 reverify probe for the Tokenizer-side catalog mirror (Evaluator-owned).
 *
 * Reads the real project registry through the shipped agent code path and
 * prints a machine-checkable observation: which subagent routes the mirror
 * publishes, whether they carry the framework VM provider proof, and whether a
 * repository without `.agents-registry.json` falls back to the user example
 * registry (it must not).
 *
 * Usage: npx tsx scripts/test/bl-native-subagent-bridges/f001-ts-mirror-probe.ts
 */
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readDispatchToolCatalog, readDispatchToolIntegrations } from "../../../src/cli/harness-tool-catalog";
import { v2SelectableToolCatalogEntries } from "../../../src/shared/harness-tool-catalog";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const catalog = readDispatchToolCatalog(repo);
const integrations = readDispatchToolIntegrations(repo);

const subagentEntries = (catalog.catalog ?? []).filter((entry) => entry.invocation === "subagent");
const selectable = v2SelectableToolCatalogEntries(catalog.catalog ?? []).filter(
  (entry) => entry.invocation === "subagent"
);

// A repository without a project registry must fail closed rather than read
// `.claude/dispatch/agents-registry.example.json`.
const empty = mkdtempSync(join(tmpdir(), "f001-no-registry-"));
mkdirSync(join(empty, ".claude", "dispatch"), { recursive: true });
cpSync(
  join(repo, "framework", "templates", "claude", "dispatch", "agents-registry.example.json"),
  join(empty, ".claude", "dispatch", "agents-registry.example.json")
);
const fallback = readDispatchToolCatalog(empty);

const observation = {
  catalog_error: catalog.error ?? null,
  subagent_routes: subagentEntries.map((entry) => ({
    tool: entry.tool,
    role: entry.role,
    provider_id: entry.subagentProvider?.id ?? null,
    provider_kind: entry.subagentProvider?.kind ?? null,
    attestation_phase: entry.subagentProvider?.attestation.phase ?? null,
    attestation_expires_at: entry.subagentProvider?.attestation.expiresAt ?? null
  })),
  selectable_subagent_routes: selectable.map((entry) => `${entry.tool}/${entry.role}`),
  codex_subagent_routes: subagentEntries.filter((entry) => entry.tool === "codex").length,
  integrations: (integrations.integrations ?? []).map((item) => ({
    tool: item.tool,
    subagent: item.subagent,
    bridge_id: item.bridgeId,
    bridge_protocol: item.bridgeProtocol ?? null,
    bridge_roles: item.bridgeRoles ?? null,
    provider_id: item.subagentProvider?.id ?? null
  })),
  no_registry_repo: { catalog: fallback.catalog, error: fallback.error ?? null }
};

console.log(JSON.stringify(observation, null, 2));
