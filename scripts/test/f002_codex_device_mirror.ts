/**
 * F002 reverify probe: the device-side catalog mirror must expose Codex only as
 * a local-cli route, with no bridge provenance on any surface.
 * Evaluator-owned artifact. Does NOT modify product code.
 */
import { readDispatchToolCatalog, readDispatchToolIntegrations } from "../../src/cli/harness-tool-catalog";

const repo = process.cwd();
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures += 1;
};

console.log("== F002 device mirror probe ==");

const catalog = readDispatchToolCatalog(repo);
const integrations = readDispatchToolIntegrations(repo);

console.log(`\ncatalog read: issue=${catalog.issue ?? "none"}`);
const entries = (catalog.entries ?? []) as unknown as Array<Record<string, unknown>>;
console.log(`entries: ${entries.length}`);
for (const e of entries) {
  console.log(
    `   tool=${String(e.tool).padEnd(12)} invocation=${String(e.invocation).padEnd(10)} role=${String(e.role ?? "")}`
  );
}

const codex = entries.filter((e) => e.tool === "codex");
const codexSubagent = codex.filter((e) => e.invocation === "subagent");
const codexLocal = codex.filter((e) => e.invocation === "local-cli");

console.log("\n[1] Codex exposure in the device catalog mirror");
check(codex.length > 0, `codex appears in the mirror (${codex.length} entries)`);
check(codexSubagent.length === 0, `codex has 0 subagent entries (got ${codexSubagent.length})`);
check(codexLocal.length > 0, `codex retains local-cli entries (${codexLocal.length})`);

console.log("\n[2] No bridge provenance leaks onto any codex entry");
const bridgeKeys = [
  "bridge_id",
  "bridge_strategy",
  "session_scope",
  "bridge_protocol",
  "bridge_provider_id",
  "bridge_provider_kind",
  "bridge_provider_contract_sha256",
  "bridge_semantics",
  "agent_type",
  "native_agent_type"
];
for (const e of codex) {
  const leaked = bridgeKeys.filter((k) => e[k] !== undefined && e[k] !== null);
  check(leaked.length === 0, `codex/${String(e.role)} carries no bridge provenance (leaked=${leaked.join(",") || "none"})`);
}

console.log("\n[3] Codex integration inventory declares no external bridge");
const inv = (integrations.integrations ?? []) as unknown as Array<Record<string, unknown>>;
console.log(`integrations read: issue=${integrations.issue ?? "none"}`);
for (const i of inv) {
  console.log(`   id=${String(i.id).padEnd(14)} keys=${Object.keys(i).join(",")}`);
}
const codexInt = inv.find((i) => i.id === "codex");
check(!!codexInt, "codex integration present in inventory");
if (codexInt) {
  const sub = codexInt.subagent;
  check(sub === undefined || sub === null || sub === false, `codex integration declares no subagent (value=${JSON.stringify(sub)})`);
}

console.log("");
if (failures === 0) {
  console.log("RESULT: PASS (device mirror keeps codex on local-cli only)");
  process.exit(0);
}
console.log(`RESULT: FAIL (${failures} checks failed)`);
process.exit(1);
