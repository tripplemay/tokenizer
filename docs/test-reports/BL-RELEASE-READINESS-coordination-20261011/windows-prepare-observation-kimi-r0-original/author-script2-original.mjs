import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const wt = '/Volumes/ORICO/project/.worktrees/tokenizer-wp1po-evaluation-20261011/BL-WINDOWS-P1-PREPARE-OBSERVATION-SUPPORT-local-cli--kimi--evaluator-windows-p1-prepare-observation-712cf21-kimi-r0';
const rel = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const cur = readFileSync(`${wt}/${rel}`, 'utf8');
const base = execSync(`git -C ${wt} show 61cf64e67a6fda231bb090e77c19d5ececb908af:${rel}`, { encoding: 'utf8', maxBuffer: 1<<24 });
const out = {};
out.map_entries = (cur.match(/TW_P1_PREPARE_FAILURE_V1:P\d\d\\n'/g) || []).length;
let r = cur;
r = r.replace(/let prepareFailurePhase = null;\nconst prepareFailureLines = \{\n(?:  P\d\d: 'TW_P1_PREPARE_FAILURE_V1:P\d\d\\n',\n){12}  P12: 'TW_P1_PREPARE_FAILURE_V1:P12\\n'\n\};\n/, '');
out.block_removed = !r.includes('prepareFailureLines');
r = r.split('\n').filter(l => !/^\s*prepareFailurePhase = ('P\d\d'|null);$/.test(l)).join('\n');
r = r.replace("if (same(args, ['--prepare'])) { prepareFailurePhase = 'P00'; prepare(); }", "if (same(args, ['--prepare'])) prepare();");
r = r.replace(/    if \(prepareFailurePhase !== null\) process\.stderr\.write\(Object\.hasOwn\(prepareFailureLines, prepareFailurePhase\) \?\n      prepareFailureLines\[prepareFailurePhase\] : prepareFailureLines\.P00\);\n/, '');
r = r.replace("const prepareSourceFiles = sourceFiles();\n", "");
r = r.replace("validateProvenance(provenance, prepareSourceFiles, executionSha)", "validateProvenance(provenance, sourceFiles(), executionSha)");
out.leftover_refs = (r.match(/prepareFailure/g) || []).length;
const strip = s => s.replace(/\s+/g, '');
out.recovered_equals_baseline_ws_stripped = strip(r) === strip(base);
if (strip(r) !== strip(base)) {
  const a = strip(base), b = strip(r);
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  out.first_diff_at = i;
  out.base_context = a.slice(Math.max(0, i - 60), i + 60);
  out.recovered_context = b.slice(Math.max(0, i - 60), i + 60);
}
console.log(JSON.stringify(out, null, 1));
