import fs from 'node:fs';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const reports = dirname(fileURLToPath(import.meta.url));
const root = resolve(reports, '../../..');
const baseline = '712cf210b089dc71f3a6e6ed2e19e1de7fee57da';
const target = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => {
  const result = cp.spawnSync('/usr/bin/git', ['-c', 'core.fileMode=false', ...args], { cwd: root, encoding: null, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0); return result.stdout;
};
const original = git('show', baseline + ':' + target), current = fs.readFileSync(join(root, target));
let reversed = current.toString('utf8');
const originalText = original.toString('utf8');
const slots = [];
function reverseRegion(slot, begin, end) {
  const a = reversed.indexOf(begin), b = reversed.indexOf(end, a);
  const oa = originalText.indexOf(begin), ob = originalText.indexOf(end, oa);
  assert(a >= 0 && b > a && oa >= 0 && ob > oa);
  slots.push({ slot, candidate_bytes: Buffer.byteLength(reversed.slice(a, b)), original_bytes: Buffer.byteLength(originalText.slice(oa, ob)) });
  reversed = reversed.slice(0, a) + originalText.slice(oa, ob) + reversed.slice(b);
}
const locals = reversed.indexOf('let prepareProvenanceObservationActive = false;');
const phaseLines = reversed.indexOf('const prepareFailureLines = {', locals);
assert(locals >= 0 && phaseLines > locals); slots.push({ slot: 'S1', candidate_bytes: phaseLines - locals, original_bytes: 0 });
reversed = reversed.slice(0, locals) + reversed.slice(phaseLines);
reverseRegion('S2', 'export function rebuild(name, value) {', 'export function validateBindings() {');
reverseRegion('S3', 'export function validateProvenance(value, files, executionSha) {', 'function assertWindowsRunner() {');
const activation = "    if (same(args, ['--prepare'])) { prepareFailurePhase = 'P00'; prepareProvenanceObservationActive = true; prepareProvenanceReason = 'V00'; prepare(); }";
assert(reversed.includes(activation)); reversed = reversed.replace(activation, "    if (same(args, ['--prepare'])) { prepareFailurePhase = 'P00'; prepare(); }");
slots.push({ slot: 'S4', changed: true });
const reset = '  prepareProvenanceObservationActive = false;\n';
assert(reversed.includes(reset)); reversed = reversed.replace(reset, ''); slots.push({ slot: 'S5', added_bytes: reset.length });
const emission = "    if (prepareProvenanceObservationActive && prepareFailurePhase === 'P11') process.stderr.write(Object.hasOwn(prepareProvenanceReasonLines, prepareProvenanceReason) ?\n      prepareProvenanceReasonLines[prepareProvenanceReason] : prepareProvenanceReasonLines.V00);\n";
assert(reversed.includes(emission)); reversed = reversed.replace(emission, ''); slots.push({ slot: 'S6', added_bytes: emission.length });
assert(Buffer.from(reversed).equals(original), 'all bytes outside six finite observation slots frozen');
const prior = JSON.parse(fs.readFileSync(join(root, 'docs/test-reports/BL-WINDOWS-P1-PROVENANCE-FAILURE-pre-scope-20261011/raw-ledger.json')));
const closurePaths = prior.source_closure.map(entry => entry.path);
const closure = closurePaths.map(path => {
  const bytes = fs.readFileSync(join(root, path)), originalBytes = git('show', baseline + ':' + path);
  const tree = git('ls-tree', baseline, '--', path).toString().trim();
  return { path, bytes: bytes.length, sha256: hash(bytes), baseline_equal: bytes.equals(originalBytes), mode: fs.statSync(join(root, path)).mode & 0o777, tree };
});
assert(closure.every(entry => entry.path === target || entry.baseline_equal));
const bindingsPath = 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json';
const bindings = JSON.parse(fs.readFileSync(join(root, bindingsPath)));
const frozen = [...bindings.prior_inputs, ...bindings.frozen_runtime_sources].map(input => ({ ...input, matches: hash(fs.readFileSync(join(root, input.path))) === input.sha256 }));
assert(frozen.every(input => input.matches));
const archiveRoot = 'docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/';
const archive = git('ls-files', archiveRoot).toString().trim().split('\n').filter(Boolean).map(path => {
  const bytes = fs.readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: hash(bytes), baseline_equal: bytes.equals(git('show', baseline + ':' + path)) };
});
assert.equal(archive.length, 57); assert(archive.every(entry => entry.baseline_equal));
const observerAssignments = current.toString().split('\n').map((line, index) => ({ line: index + 1, text: line })).filter(row => /prepareProvenanceReason =|observationStage =/.test(row.text));
const result = {
  format: 'windows-p1-provenance-observation-static-development-v1', baseline,
  source: { path: target, original_sha256: hash(original), sha256: hash(current), bytes: current.length, current_mode: fs.statSync(join(root, target)).mode & 0o777 },
  six_slot_reversal_equals_baseline: true, slots, closure, frozen, archive,
  observerAssignments, proposal_sha256: hash(fs.readFileSync(join(root, 'docs/test-reports/BL-WINDOWS-P1-PROVENANCE-FAILURE-plan-20261011/proposal.json'))),
  reason_literal_bytes: 4, original_generic_bytes: 51, original_P11_bytes: 29, new_contract_maximum_bytes: 84,
  new_84_not_old_80_compliant: true, candidate_executed_by_this_audit: false, functional_acceptance: false
};
fs.mkdirSync(join(reports, 'source-originals'), { recursive: true });
for (const [name, bytes] of [['source712-p1-stages.mjs', original], ['candidate-p1-stages.mjs', current], ['source.diff', git('diff', '--', target)]])
  fs.writeFileSync(join(reports, 'source-originals', name), bytes);
fs.writeFileSync(join(reports, 'static-audit.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ six_slot_reversal_equals_baseline: true, closure_entries: closure.length, frozen_inputs: frozen.length, archive_entries: archive.length, source: result.source }) + '\n');
