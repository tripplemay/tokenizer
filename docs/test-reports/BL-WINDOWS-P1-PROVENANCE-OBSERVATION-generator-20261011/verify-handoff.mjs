import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const reports = dirname(fileURLToPath(import.meta.url));
const root = resolve(reports, '../../..');
const source = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const commit = '62d419b2a419b685542efaaf047b8a749839d493';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => {
  const result = cp.spawnSync('/usr/bin/git', ['-c', 'core.fileMode=false', ...args], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0); return result.stdout;
};
const bytes = fs.readFileSync(join(root, source));
assert.equal(hash(bytes), '411c9e10fe35bfe231d0c5daf0b01ead77f18464688d67a910c103e433d760b1');
assert(bytes.equals(git('show', commit + ':' + source)));
assert(bytes.equals(fs.readFileSync(join(reports, 'source-originals/candidate-p1-stages.mjs'))));
assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).toString(), source + '\n');
assert.equal(git('status', '--porcelain', '--', source).toString(), '');
const install = JSON.parse(fs.readFileSync(join(reports, 'install-evidence.json')));
assert.equal(install.npm_ci_status, 0); assert.equal(install.high_severity_reported, 7);
for (const original of install.originals) {
  const current = fs.readFileSync(original.source), archived = fs.readFileSync(join(root, original.archived));
  assert(current.equals(archived)); assert.equal(hash(archived), original.sha256); assert.equal(archived.length, original.bytes);
}
assert.equal(fs.readdirSync(join(install.npmcache, '_logs')).length, install.cache_logs_copied);
assert.equal(install.core_version, '1.16.13'); assert.equal(install.wasm_version, '1.16.13');
assert(install.wasm_absent_from_root_lock && !install.installed_lock_wasm_present && install.links.every(link => link.owned));
assert.equal(hash(fs.readFileSync(join(root, 'tests/diagnostics/windows-p1-stages.test.ts'))), '7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132');
const tests = JSON.parse(fs.readFileSync(join(reports, 'original-81-tests.json')));
assert.equal(tests.numPassedTests, 81); assert.equal(tests.numFailedTests, 0);
for (const id of ['01-npm-ci', '04-original-81-tests', '05-npm-verify', '07-normal-pure-import', '08-final-node-check', '09-source-diff-check'])
  assert.equal(JSON.parse(fs.readFileSync(join(reports, id + '.result.json'))).status, 0);
for (const stream of ['stdout', 'stderr']) assert.equal(fs.readFileSync(join(reports, '07-normal-pure-import.' + stream + '.log')).length, 0);
const result = { source_commit: commit, source_sha256: hash(bytes), source_bytes: bytes.length, source_frozen_equal_committed_and_archived: true,
  only_source_commit_path: source, archived_install_originals_equal: install.originals.length,
  all_own_npm_debug_logs_retained: install.cache_logs_copied, frozen_tests_sha256: hash(fs.readFileSync(join(root, 'tests/diagnostics/windows-p1-stages.test.ts'))),
  original_tests_passed: tests.numPassedTests, verified_import_stdout_stderr_bytes: 0, development_only: true, functional_acceptance: false };
fs.writeFileSync(join(reports, 'final-integrity.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(result) + '\n');
