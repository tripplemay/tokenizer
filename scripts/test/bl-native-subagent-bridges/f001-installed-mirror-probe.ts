/**
 * F001 reverify probe for the *installed* Tokenizer agent catalog mirror.
 *
 * The mirror deliberately refuses to authorize a catalog for its own install
 * root, so it must be exercised in the deployed topology: the agent module is
 * loaded from the installed app bundle while the inspected repository is the
 * separate project checkout.
 *
 * Usage (from the installed bundle root so tsx/tsconfig resolve):
 *   cd ~/.tokenizer/app && node --import tsx \
 *     <repo>/scripts/test/bl-native-subagent-bridges/f001-installed-mirror-probe.ts \
 *     <app-root> <repo-path>
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [appRoot, repoPath] = process.argv.slice(2);
if (!appRoot || !repoPath) throw new Error("usage: probe <app-root> <repo-path>");

const mirror = await import(pathToFileURL(join(appRoot, "src/cli/harness-tool-catalog.ts")).href);
const shared = await import(pathToFileURL(join(appRoot, "src/shared/harness-tool-catalog.ts")).href);

const catalog = mirror.readDispatchToolCatalog(repoPath);
const integrations = mirror.readDispatchToolIntegrations(repoPath);
const entries = catalog.entries ?? [];
const subagentEntries = entries.filter((entry: { invocation: string }) => entry.invocation === "subagent");

const emptyRepo = mkdtempSync(join(tmpdir(), "f001-no-registry-"));
mkdirSync(join(emptyRepo, ".claude", "dispatch"), { recursive: true });
const example = join(repoPath, "framework/templates/claude/dispatch/agents-registry.example.json");
if (existsSync(example)) cpSync(example, join(emptyRepo, ".claude/dispatch/agents-registry.example.json"));
const noRegistry = mirror.readDispatchToolCatalog(emptyRepo);

console.log(
  JSON.stringify(
    {
      app_root: appRoot,
      repo_path: repoPath,
      catalog_issue: catalog.issue ?? null,
      total_entries: entries.length,
      subagent_routes: subagentEntries.map((entry: Record<string, any>) => ({
        tool: entry.tool,
        role: entry.role,
        provider_id: entry.subagentProvider?.id ?? null,
        provider_kind: entry.subagentProvider?.kind ?? null,
        attestation_version: entry.subagentProvider?.attestation?.version ?? null,
        attestation_phase: entry.subagentProvider?.attestation?.phase ?? null,
        attestation_expires_at: entry.subagentProvider?.attestation?.expiresAt ?? null
      })),
      selectable_subagent_routes: shared
        .v2SelectableToolCatalogEntries(entries)
        .filter((entry: { invocation: string }) => entry.invocation === "subagent")
        .map((entry: { tool: string; role: string }) => `${entry.tool}/${entry.role}`),
      integrations: (integrations.integrations ?? []).map((item: Record<string, any>) => ({
        tool: item.tool,
        subagent: item.subagent,
        bridge_id: item.bridgeId,
        bridge_protocol: item.bridgeProtocol ?? null,
        bridge_roles: item.bridgeRoles ?? null,
        provider_id: item.subagentProvider?.id ?? null
      })),
      no_registry_repo: {
        entries: noRegistry.entries ?? null,
        issue: noRegistry.issue ?? null
      }
    },
    null,
    2
  )
);
