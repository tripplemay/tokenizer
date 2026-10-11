// Own read-only analyst transform (kimi r1 evidence evaluator).
// Removes ONLY the commissioned observation slots from candidate source712
// p1-stages.mjs and compares exact remaining bytes against baseline61 blob.
// No import/compile/eval of the candidate; pure string surgery + hashing.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const SRC = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-prepare-observation-generator-20261011';
const REL = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const BASE = '61cf64e67a6fda231bb090e77c19d5ececb908af';
const WANT_CANDIDATE_SHA = 'c245a528fb8549915396b5f052bf3841f35b03d88d6b7b5e91982b6f0f07dc4f';
const sha256 = b => createHash('sha256').update(b).digest('hex');

const candidate = readFileSync(`${SRC}/${REL}`);
const baseline = execFileSync('git', ['-C', SRC, 'show', `${BASE}:${REL}`], { maxBuffer: 1 << 28 });

const phases = ['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'];
const mapLines = ['P00', ...phases].map((p, i, a) =>
  `  ${p}: 'TW_P1_PREPARE_FAILURE_V1:${p}\\n'${i < a.length - 1 ? ',' : ''}`);
const moduleBlock =
  'let prepareFailurePhase = null;\n' +
  'const prepareFailureLines = {\n' +
  mapLines.join('\n') + '\n' +
  '};\n';

const steps = [];
steps.push(['module_state_block', moduleBlock, '', 1]);
for (const p of phases) steps.push([`phase_assign_${p}`, `  prepareFailurePhase = '${p}';\n`, '', 1]);
steps.push(['success_reset', '  prepareFailurePhase = null;\n', '', 1]);
steps.push(['rejoin_runner_bindings',
  '  assertWindowsRunner();\n  validateBindings();\n',
  '  assertWindowsRunner(); validateBindings();\n', 1]);
steps.push(['rejoin_checkout_assert',
  '  const executionSha = checkoutSha();\n  assert.equal(executionSha, process.env.GITHUB_SHA);\n',
  '  const executionSha = checkoutSha(); assert.equal(executionSha, process.env.GITHUB_SHA);\n', 1]);
steps.push(['rejoin_safe_mkdir',
  '  safeDirectory(dirname(scratch));\n  original.mkdirSync(scratch);\n',
  '  safeDirectory(dirname(scratch)); original.mkdirSync(scratch);\n', 1]);
steps.push(['reverse_sourcefiles_local_split',
  '  const prepareSourceFiles = sourceFiles();\n  assert(validateProvenance(provenance, prepareSourceFiles, executionSha));\n',
  '  assert(validateProvenance(provenance, sourceFiles(), executionSha));\n', 1]);
steps.push(['dispatch_p00_activation',
  "    if (same(args, ['--prepare'])) { prepareFailurePhase = 'P00'; prepare(); }\n",
  "    if (same(args, ['--prepare'])) prepare();\n", 1]);
steps.push(['terminal_catch_observation_line',
  '    if (prepareFailurePhase !== null) process.stderr.write(Object.hasOwn(prepareFailureLines, prepareFailurePhase) ?\n' +
  '      prepareFailureLines[prepareFailurePhase] : prepareFailureLines.P00);\n', '', 1]);

let text = candidate.toString('utf8');
const applied = [];
for (const [name, search, replacement, want] of steps) {
  const count = text.split(search).length - 1;
  if (count !== want) {
    console.log(JSON.stringify({ fatal: `slot ${name} occurrence ${count} != ${want}`, applied }));
    process.exit(2);
  }
  text = text.split(search).join(replacement);
  applied.push({ slot: name, occurrences: count, search_bytes: Buffer.byteLength(search), replacement_bytes: Buffer.byteLength(replacement) });
}

const out = Buffer.from(text, 'utf8');
const residuals = ['prepareFailurePhase', 'prepareFailureLines', 'TW_P1_PREPARE_FAILURE_V1', 'prepareSourceFiles']
  .filter(s => text.includes(s));
const result = {
  candidate_sha256: sha256(candidate),
  candidate_bytes: candidate.length,
  candidate_matches_source712: sha256(candidate) === WANT_CANDIDATE_SHA,
  baseline61_sha256: sha256(baseline),
  baseline61_bytes: baseline.length,
  output_sha256: sha256(out),
  output_bytes: out.length,
  output_equals_baseline61_buffer: out.equals(baseline),
  slots_applied: applied.length,
  bytes_removed_net: candidate.length - out.length,
  residual_observation_tokens: residuals,
  whitespace_normalization_used: false,
};
console.log(JSON.stringify(result, null, 2));
