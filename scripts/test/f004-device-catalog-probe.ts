/**
 * Evaluator-owned read-only probe for BL-NATIVE-SUBAGENT-BRIDGES F004.
 *
 * Reads the real device tool inventory through the Tokenizer Agent's
 * TypeScript catalog mirror and prints a redacted structural summary so the
 * framework (Python) catalog, the Agent mirror and the console can be compared
 * on the same machine registry. It writes nothing and starts no bridge job.
 *
 * Usage: npx tsx scripts/test/f004-device-catalog-probe.ts
 */
import { readDispatchToolInventory } from "../../src/cli/harness-tool-catalog";
import { isV2SelectableToolCatalogEntry } from "../../src/shared/harness-tool-catalog";

const REPO = process.argv[2] ?? process.cwd();
const NOW = Date.now();

function redact(digest: string | undefined): string {
  return digest ? `${digest.slice(0, 8)}…(${digest.length})` : "none";
}

const inventory = readDispatchToolInventory(REPO);

const entries = inventory.catalog.entries.map((entry) => ({
  role: entry.role,
  tool: entry.tool,
  invocation: entry.invocation,
  modelFamilies: entry.modelFamilies,
  selectable: isV2SelectableToolCatalogEntry(entry, NOW),
  provider: entry.subagentProvider
    ? {
        id: entry.subagentProvider.id,
        kind: entry.subagentProvider.kind,
        contractSha256: redact(entry.subagentProvider.contractSha256),
        phase: entry.subagentProvider.attestation.phase,
        nonceSha256: redact(entry.subagentProvider.attestation.nonceSha256),
        ttlSeconds:
          (Date.parse(entry.subagentProvider.attestation.expiresAt) -
            Date.parse(entry.subagentProvider.attestation.issuedAt)) / 1000
      }
    : null
}));

const integrations = inventory.integrations.integrations.map((integration) => ({
  id: integration.id,
  tool: integration.tool,
  modelFamily: integration.modelFamily,
  invocations: integration.invocations,
  subagent: integration.subagent,
  bridgeId: integration.bridgeId,
  bridgeKind: integration.bridgeKind,
  sessionScope: integration.sessionScope,
  bridgeProtocol: integration.bridgeProtocol ?? null,
  bridgeRoles: integration.bridgeRoles ?? null,
  hasProviderProof: Boolean(integration.subagentProvider)
}));

console.log(JSON.stringify({
  repo: REPO,
  catalogIssue: inventory.catalog.issue,
  integrationIssue: inventory.integrations.issue,
  subagentEntries: entries.filter((entry) => entry.invocation === "subagent"),
  selectableCounts: {
    total: entries.length,
    selectable: entries.filter((entry) => entry.selectable).length,
    subagent: entries.filter((entry) => entry.invocation === "subagent").length
  },
  toolsByRole: Object.fromEntries(
    ["planner", "generator", "evaluator"].map((role) => [
      role,
      entries.filter((entry) => entry.role === role).map((entry) => `${entry.tool}:${entry.invocation}`).sort()
    ])
  ),
  integrations
}, null, 2));
