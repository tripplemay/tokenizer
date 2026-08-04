/**
 * F002 reverify probe: the mode-intent issuance path must refuse any Codex
 * `subagent` binding, and must still accept Codex as local-cli.
 * Evaluator-owned artifact. Does NOT modify product code.
 *
 * Payload shape is rebuilt from the public types (mirrors the shipped
 * tool-binding fixture) so a malformed probe cannot masquerade as a refusal.
 */
import {
  validateHarnessModeIntentPayload,
  type HarnessModeToolDescriptor
} from "../../src/shared/harness-mode-intent";
import { readDispatchToolCatalog } from "../../src/cli/harness-tool-catalog";
import { toolCatalogModeDescriptors } from "../../src/shared/harness-tool-catalog";

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures += 1;
};

const NOW = new Date();

console.log("== F002 issuance-refusal probe ==");

// Descriptors derived from the REAL project registry via the device mirror.
const entries = readDispatchToolCatalog(process.cwd()).entries;
const descriptors = toolCatalogModeDescriptors(entries) as HarnessModeToolDescriptor[];

const codexSubagentDescriptors = descriptors.filter(
  (d) => d.tool === "codex" && d.invocation === "subagent"
);
console.log(`\nlive descriptors: ${descriptors.length}`);
check(
  codexSubagentDescriptors.length === 0,
  `no codex+subagent descriptor is offered for signing (got ${codexSubagentDescriptors.length})`
);

function intent(bindings: Record<string, unknown>): Record<string, unknown> {
  return {
    intent_id: "f002-reverify-probe",
    repo_key: "git@github.com:acme/tokenizer.git",
    expected_head_sha: "172ed42b5c4d910c7f194a6fab835c8ac74f19e7",
    desired: {
      execution: { profile: "heterogeneous", role_bindings: bindings },
      autonomy: { enabled: false }
    },
    issued_by: "evaluator@f002.probe",
    issued_at: NOW.toISOString(),
    intent_expires_at: new Date(NOW.getTime() + 3600_000).toISOString()
  };
}

function run(label: string, bindings: Record<string, unknown>) {
  const result = validateHarnessModeIntentPayload(intent(bindings) as never, {
    now: NOW,
    tools: descriptors
  });
  const ok = (result as { ok?: boolean }).ok === true;
  const detail = ok ? "accepted" : JSON.stringify((result as { error?: unknown }).error);
  return { ok, detail, label };
}

console.log("\n[0] control: the probe payload shape is valid (codex local-cli baseline)");
const control = run("control", {
  planner: null,
  generator: { tool: "kimi", invocation: "local-cli" },
  evaluator: { tool: "codex", invocation: "local-cli" }
});
check(control.ok, `kimi(local-cli) generator + codex(local-cli) evaluator accepted -> ${control.detail}`);

console.log("\n[1] Codex subagent binding is refused for every role");
const cases = [
  {
    label: "codex subagent as generator",
    bindings: {
      planner: null,
      generator: { tool: "codex", invocation: "subagent" },
      evaluator: { tool: "kimi", invocation: "local-cli" }
    }
  },
  {
    label: "codex subagent as evaluator",
    bindings: {
      planner: null,
      generator: { tool: "kimi", invocation: "local-cli" },
      evaluator: { tool: "codex", invocation: "subagent" }
    }
  },
  {
    label: "codex subagent as planner",
    bindings: {
      planner: { tool: "codex", invocation: "subagent" },
      generator: { tool: "kimi", invocation: "local-cli" },
      evaluator: { tool: "codex", invocation: "local-cli" }
    }
  }
];
for (const c of cases) {
  const r = run(c.label, c.bindings);
  check(!r.ok, `${c.label} refused -> ${r.detail}`);
}

console.log("");
if (failures === 0) {
  console.log("RESULT: PASS (issuance refuses codex bridge, keeps codex local-cli signable)");
  process.exit(0);
}
console.log(`RESULT: FAIL (${failures} checks failed)`);
process.exit(1);
