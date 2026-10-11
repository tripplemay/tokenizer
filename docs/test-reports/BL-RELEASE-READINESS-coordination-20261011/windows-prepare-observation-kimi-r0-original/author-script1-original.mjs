import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const wt = '/Volumes/ORICO/project/.worktrees/tokenizer-wp1po-evaluation-20261011/BL-WINDOWS-P1-PREPARE-OBSERVATION-SUPPORT-local-cli--kimi--evaluator-windows-p1-prepare-observation-712cf21-kimi-r0';
const rel = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const cur = readFileSync(`${wt}/${rel}`, 'utf8');
const base = execSync(`git -C ${wt} show 61cf64e67a6fda231bb090e77c19d5ececb908af:${rel}`, { encoding: 'utf8', maxBuffer: 1<<24 });
const out = {};
// 1. thirteen literals exact 29 bytes
const phases = ['P00','P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'];
out.literal_bytes = phases.map(p => { const s = `TW_P1_PREPARE_FAILURE_V1:${p}\n`; return [p, Buffer.byteLength(s)]; });
out.all_29 = out.literal_bytes.every(([,n]) => n === 29);
out.map_has_exactly_13 = (cur.match(/TW_P1_PREPARE_FAILURE_V1:P\d\d\\n',/g) || []).length === 13;
out.generic_bytes = Buffer.byteLength('windows-p1-initial diagnostic evidence unavailable\n');
out.catch_max = out.generic_bytes + 29;
// 2. baseline recovery: revert permitted slots in cur, compare whitespace-stripped
let r = cur;
// module block: 16 lines from 'let prepareFailurePhase' through '};'
r = r.replace(/let prepareFailurePhase = null;\nconst prepareFailureLines = \{\n(?:  P\d\d: 'TW_P1_PREPARE_FAILURE_V1:P\d\d\\n',\n){12}  P12: 'TW_P1_PREPARE_FAILURE_V1:P12\\n'\n\};\n/, '');
if (r.includes('prepareFailureLines = {')) { out.block_removal = 'FAILED'; } else out.block_removal = 'ok';
// phase assignment lines
r = r.split('\n').filter(l => !/^\s*prepareFailurePhase = ('P\d\d'|null);$/.test(l)).join('\n');
// dispatch revert
r = r.replace("if (same(args, ['--prepare']))  prepare();", "if (same(args, ['--prepare'])) prepare();"); // safety no-op variant
r = r.replace("if (same(args, ['--prepare'])) {  prepare(); }", "if (same(args, ['--prepare'])) prepare();");
// catch revert: remove the two added lines
r = r.replace(/    if \(prepareFailurePhase !== null\) process\.stderr\.write\(Object\.hasOwn\(prepareFailureLines, prepareFailurePhase\) \?\n      prepareFailureLines\[prepareFailurePhase\] : prepareFailureLines\.P00\);\n/, '');
// second pass split revert
r = r.replace("const prepareSourceFiles = sourceFiles();\n", "");
r = r.replace("validateProvenance(provenance, prepareSourceFiles, executionSha)", "validateProvenance(provenance, sourceFiles(), executionSha)");
const strip = s => s.replace(/\s+/g, '');
out.recovered_equals_baseline_ws_stripped = strip(r) === strip(base);
out.leftover_prepareFailure_refs = (r.match(/prepareFailure/g) || []).length;
// 3. identity literals
const grab = (s, re) => (s.match(re) || []).sort();
const idRe = /'(bindingHash|mdHash)'[^,\n]*|[a-f0-9]{64}/g;
out.identity_literals_equal = JSON.stringify(grab(cur, idRe)) === JSON.stringify(grab(base, idRe));
out.identity_literal_count_cur = grab(cur, idRe).length;
// 4. line-ending / hygiene
out.crlf_in_new_regions = /\r/.test(cur);
out.cur_bytes = Buffer.byteLength(cur); out.base_bytes = Buffer.byteLength(base);
out.delta_bytes = out.cur_bytes - out.base_bytes;
console.log(JSON.stringify(out, null, 1));
