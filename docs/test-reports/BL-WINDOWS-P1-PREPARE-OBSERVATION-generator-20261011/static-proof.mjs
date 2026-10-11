import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-prepare-observation-generator-20261011';
const report = join(repo, 'docs/test-reports/BL-WINDOWS-P1-PREPARE-OBSERVATION-generator-20261011');
const baseline = '61cf64e67a6fda231bb090e77c19d5ececb908af';
const start = '27dd6bcec281fa7bd0c8ca14fce9749b40be1735';
const source = '712cf210b089dc71f3a6e6ed2e19e1de7fee57da';
const target = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => {
  const result = cp.spawnSync('git', ['-c', 'core.fileMode=false', ...args], { cwd: repo, env: process.env, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0); assert.equal(result.stderr.length, 0);
  return result.stdout;
};
const tree = ref => git(['ls-tree', '-r', '-z', ref]).toString().split('\0').filter(Boolean).map(row => {
  const [record, path] = row.split('\t');
  const [mode, type, oid] = record.split(' ');
  return { path, mode, type, oid, row };
});
const baseTree = tree(baseline), startTree = tree(start), sourceTree = tree(source);
const sourceMap = new Map(sourceTree.map(row => [row.path, row]));
for (const row of baseTree) if (row.path !== target) assert.deepEqual(sourceMap.get(row.path), row);
for (const row of startTree) if (row.path !== target) assert.deepEqual(sourceMap.get(row.path), row);
assert.equal(sourceTree.length, startTree.length);
const batch = cp.spawnSync('git', ['-c', 'core.fileMode=false', 'cat-file', '--batch'], {
  cwd: repo, env: process.env, input: startTree.map(row => row.oid).join('\n') + '\n', maxBuffer: 128 * 1024 * 1024
});
assert.equal(batch.status, 0); assert.equal(batch.stderr.length, 0);
let offset = 0, workingUnchanged = 0;
const startBlobs = new Map();
for (const row of startTree) {
  const lf = batch.stdout.indexOf(10, offset);
  const [oid, type, sizeText] = batch.stdout.subarray(offset, lf).toString().split(' ');
  assert.equal(oid, row.oid); assert.equal(type, 'blob');
  const size = Number(sizeText), bytes = batch.stdout.subarray(lf + 1, lf + 1 + size);
  offset = lf + 1 + size + 1;
  startBlobs.set(row.path, bytes);
  if (row.path === target) continue;
  const actual = row.mode === '120000' ? Buffer.from(fs.readlinkSync(join(repo, row.path))) : fs.readFileSync(join(repo, row.path));
  assert(actual.equals(bytes), row.path);
  workingUnchanged++;
}
assert.equal(offset, batch.stdout.length);
const before = startBlobs.get(target).toString(), currentBytes = fs.readFileSync(join(repo, target)), current = currentBytes.toString();
let projected = current.replace(/let prepareFailurePhase = null;\nconst prepareFailureLines = \{[\s\S]*?\n\};\n/, '');
projected = projected.replace(/^  prepareFailurePhase = (?:'P\d\d'|null);\n/gm, '');
projected = projected.replace('  assertWindowsRunner();\n  validateBindings();', '  assertWindowsRunner(); validateBindings();');
projected = projected.replace('  const executionSha = checkoutSha();\n  assert.equal(executionSha, process.env.GITHUB_SHA);', '  const executionSha = checkoutSha(); assert.equal(executionSha, process.env.GITHUB_SHA);');
projected = projected.replace('  safeDirectory(dirname(scratch));\n  original.mkdirSync(scratch);', '  safeDirectory(dirname(scratch)); original.mkdirSync(scratch);');
projected = projected.replace('  const prepareSourceFiles = sourceFiles();\n  assert(validateProvenance(provenance, prepareSourceFiles, executionSha));', '  assert(validateProvenance(provenance, sourceFiles(), executionSha));');
projected = projected.replace("if (same(args, ['--prepare'])) { prepareFailurePhase = 'P00'; prepare(); }", "if (same(args, ['--prepare'])) prepare();");
projected = projected.replace('    if (prepareFailurePhase !== null) process.stderr.write(Object.hasOwn(prepareFailureLines, prepareFailurePhase) ?\n      prepareFailureLines[prepareFailurePhase] : prepareFailureLines.P00);\n', '');
assert.equal(projected, before);
const phases = Array.from({ length: 13 }, (_, n) => 'P' + String(n).padStart(2, '0'));
const literalRows = [...current.matchAll(/  (P\d\d): '(TW_P1_PREPARE_FAILURE_V1:P\d\d\\n)'/g)];
assert.deepEqual(literalRows.map(row => row[1]), phases);
const literalLengths = literalRows.map(row => ({ phase: row[1], bytes: Buffer.byteLength(row[2].replace('\\n', '\n')) }));
assert(literalLengths.every(row => row.bytes === 29));
const prepareBody = current.slice(current.indexOf('function prepare() {'), current.indexOf('export function checksSummary'));
assert.deepEqual([...prepareBody.matchAll(/prepareFailurePhase = '(P\d\d)'/g)].map(row => row[1]), phases.slice(1));
assert.equal((prepareBody.match(/sourceFiles\(\)/g) ?? []).length, 2);
const bindingPath = 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json';
const binding = JSON.parse(fs.readFileSync(join(repo, bindingPath)));
const inputHashes = [...binding.prior_inputs, ...binding.frozen_runtime_sources].map(input => {
  const actual = hash(fs.readFileSync(join(repo, input.path)));
  assert.equal(actual, input.sha256); return { path: input.path, sha256: actual };
});
assert.equal(inputHashes.length, 10);
const sourcePaths = [...binding.future_added_source_paths, bindingPath, ...binding.frozen_runtime_sources.map(row => row.path)].sort();
assert.equal(sourcePaths.length, 11); assert.equal(binding.output.upload_files.length, 16);
const scripts = binding.cases.map(row => { assert.equal(hash(row.script), row.scriptSha256); return { variant: row.variant, sha256: row.scriptSha256 }; });
assert.deepEqual(scripts.map(row => row.variant), ['T0', 'T1', 'T2', 'T3']);
const archiveRoot = 'docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/';
const archive = baseTree.filter(row => row.path.startsWith(archiveRoot)); assert.equal(archive.length, 57);
const archiveRows = git(['ls-tree', '-r', baseline, '--', archiveRoot]);
const testPath = 'tests/diagnostics/windows-p1-stages.test.ts';
const vendor = startTree.filter(row => row.path.startsWith('vendor/braces/')); assert.equal(vendor.length, 12);
const evidence = {
  role: 'fresh-supporting-Generator', scope: 'author static development proof, not independent acceptance', baseline, start, source,
  target, source_sha256: hash(currentBytes), baseline_source_sha256: hash(startBlobs.get(target)),
  source61_tree_paths: baseTree.length, start_tree_paths: startTree.length, source_tree_paths: sourceTree.length,
  all_baseline_tree_records_except_cli_unchanged: true, all_start_tree_records_except_cli_unchanged: true,
  all_start_working_bytes_except_cli_unchanged: true, working_unchanged_count: workingUnchanged,
  permitted_slot_reverse_projection_exact_original_bytes: true, literal_lengths: literalLengths,
  generic_bytes: Buffer.byteLength('windows-p1-initial diagnostic evidence unavailable\n'), terminal_max_bytes: 80,
  prepare_phase_assignment_sequence: phases.slice(1), prepare_source_read_passes: 2, input_hashes: inputHashes,
  source_paths: sourcePaths, uploads: binding.output.upload_files, decoded_fixed_scripts: scripts,
  binding_json_sha256: hash(fs.readFileSync(join(repo, bindingPath))),
  binding_md_sha256: hash(fs.readFileSync(join(repo, 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md'))),
  workflow_sha256: hash(fs.readFileSync(join(repo, '.github/workflows/windows-p1-stages-diagnostic.yml'))),
  original_test: { path: testPath, bytes: startBlobs.get(testPath).length, sha256: hash(startBlobs.get(testPath)) },
  historical_archive: { tracked_files: archive.length, tree_rows_sha256: hash(archiveRows), all_tree_records_and_working_bytes_unchanged: true, limit: 'Not remote authentication or the historical 59-file inventory' },
  vendor_braces: { tracked_files: vendor.length, all_tree_records_and_working_bytes_unchanged: true },
  target_import_or_execution: false, native_or_CLI_or_VM_execution: false, release_ready: false
};
const outputName = process.argv[2] ?? 'static-evidence.json';
assert(['static-evidence.json', 'static-after-development-evidence.json'].includes(outputName));
fs.writeFileSync(join(report, outputName), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(evidence, null, 2));
