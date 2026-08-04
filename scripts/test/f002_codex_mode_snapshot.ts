/**
 * F002 reverify probe: the device mode snapshot (the payload the console renders
 * for the signing page) must not carry Codex bridge provenance.
 * Evaluator-owned artifact. Does NOT modify product code.
 */
import { buildModeSnapshot } from "../../src/cli/harness-modes";

const snap = buildModeSnapshot(process.cwd()) as unknown as {
  dispatch?: { toolCatalog?: Array<Record<string, unknown>> };
};
const cat = snap?.dispatch?.toolCatalog ?? [];
console.log("== F002 mode-snapshot probe ==");
console.log(`toolCatalog entries in device mode snapshot: ${cat.length}`);

const codex = cat.filter((e) => e.tool === "codex");
for (const e of codex) {
  console.log(
    `  codex role=${String(e.role)} invocation=${String(e.invocation)} ` +
      `bridgeId=${JSON.stringify(e.bridgeId)} sessionScope=${JSON.stringify(e.sessionScope)} ` +
      `bridgeKind=${JSON.stringify(e.bridgeKind)}`
  );
}

const codexSub = codex.filter((e) => e.invocation === "subagent");
const anySub = cat.filter((e) => e.invocation === "subagent");
const leaked = codex.filter(
  (e) => e.bridgeId || e.sessionScope || e.bridgeKind || e.bridgeProtocol || e.subagentProvider
);

console.log(`\ncodex subagent entries: ${codexSub.length}`);
console.log(`any-tool subagent entries: ${anySub.length}`);
console.log(`codex entries carrying bridge provenance: ${leaked.length}`);

const ok = codexSub.length === 0 && leaked.length === 0 && codex.length > 0;
console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
process.exit(ok ? 0 : 1);
