import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-prepare-observation-generator-20261011';
const report = join(repo, 'docs/test-reports/BL-WINDOWS-P1-PREPARE-OBSERVATION-generator-20261011');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = JSON.parse(fs.readFileSync(join(report, 'development-provenance.json')));
for (const capture of provenance.npm_logs) {
  const bytes = fs.readFileSync(capture.original), copy = fs.readFileSync(join(repo, capture.report_path));
  assert.equal(bytes.length, capture.bytes); assert.equal(hash(bytes), capture.sha256); assert(bytes.equals(copy));
}
assert.equal(fs.readdirSync('/Volumes/ORICO/project/.wp1pog-20261011/npm-cache/_logs').length, provenance.npm_logs.length);
fs.mkdirSync(join(report, 'installed-lifecycle-originals'));
const captures = ['node_modules/@swc/core/package.json', 'node_modules/@swc/core/postinstall.js',
  'node_modules/@swc/wasm/package.json', 'node_modules/@prisma/client/package.json',
  'node_modules/@prisma/engines/package.json', 'node_modules/prisma/package.json',
  'node_modules/better-sqlite3/package.json'].map((path, n) => {
  const bytes = fs.readFileSync(join(repo, path)), name = String(n + 1).padStart(2, '0') + '-' + path.replaceAll('/', '__');
  const output = join(report, 'installed-lifecycle-originals', name);
  fs.copyFileSync(join(repo, path), output, fs.constants.COPYFILE_EXCL);
  assert(bytes.equals(fs.readFileSync(output)));
  return { original_path: path, report_path: relative(repo, output), bytes: bytes.length, sha256: hash(bytes) };
});
const debugName = provenance.npm_logs.find(row => fs.readFileSync(join(repo, row.report_path), 'utf8').includes('verbose title npm install @swc/wasm@1.16.13'));
assert(debugName);
const debug = fs.readFileSync(join(repo, debugName.report_path), 'utf8');
const wasm = provenance.packages.find(row => row.name === '@swc/wasm' && row.path === 'node_modules/@swc/wasm');
assert.equal(wasm.version, '1.16.13'); assert.equal(wasm.package_lock_entry_present, false);
assert(debug.includes('https://registry.npmjs.org/@swc/wasm/-/wasm-1.16.13.tgz'));
assert(debug.includes('verbose exit 0'));
const raw = JSON.parse(fs.readFileSync(join(report, '04-original81.raw.json')));
assert.equal(raw.numTotalTests, 81); assert.equal(raw.numPassedTests, 81); assert.equal(raw.numFailedTests, 0);
assert.equal(raw.numPendingTests, 0); assert.equal(raw.success, true);
assert(provenance.commands.every(row => row.status === 0 && row.signal === null && row.launch_error === null));
for (const row of provenance.commands) for (const stream of ['stdout', 'stderr']) {
  const bytes = fs.readFileSync(join(repo, row[stream].path));
  assert.equal(bytes.length, row[stream].bytes); assert.equal(hash(bytes), row[stream].sha256);
}
assert(fs.readFileSync(join(report, '03-npm-ci.stdout.log'), 'utf8').includes('7 high severity vulnerabilities'));
const pureImport = provenance.commands.find(row => row.name === '07-pure-import');
assert.equal(pureImport.stdout.bytes, 0); assert.equal(pureImport.stderr.bytes, 0);
const extraNames = provenance.lock_absent_package_json_entries.map(row => ({ path: row.path, name: row.name, version: row.version }));
const evidence = {
  role: 'fresh-supporting-Generator', source: '712cf210b089dc71f3a6e6ed2e19e1de7fee57da',
  captured_utc: new Date().toISOString(), commands_exit0: provenance.commands.map(row => row.name),
  original81: { total: 81, passed: 81, failed: 0, skipped: 0, original_raw_json_retained: true },
  npm_ci_attempts: 1, npm_ci_retry: false, npm_ci_high_severity_count: 7,
  full_stdout_stderr_status_and_all_three_owned_npm_debug_originals_retained: true,
  swc_fallback: {
    package: '@swc/core', locked_version: '1.16.13', declared_postinstall: 'node postinstall.js',
    raw_debug: debugName, child_command: 'npm install --no-save --loglevel=error --prefer-offline --no-audit --progress=false @swc/wasm@1.16.13',
    child_cwd: 'node_modules/@swc/core/npm-install', child_exit: 0,
    observed_registry: 'https://registry.npmjs.org/', installed_path: wasm.path, installed_version: wasm.version,
    installed_package_absent_original_lock_and_npm_installed_lock: true,
    lifecycle_reference: 'Installed postinstall.js lines125-128 launches fallback npm and moves its package into own root node_modules; passive read only',
    default_parent_stderr_does_not_show_fallback: !fs.readFileSync(join(report, '03-npm-ci.stderr.log'), 'utf8').includes('@swc/wasm'),
    root_cause_of_native_binding_failure: 'Not diagnosed; original logs do not expose the hidden successful lifecycle warning',
    all_lock_only_or_native_pass: false
  },
  lock_absent_package_json_entries: extraNames, installed_lifecycle_originals: captures,
  all_47_dependency_link_realpaths_confined_to_own_worktree: provenance.symlinks.length === 47,
  borrowed_deps_cache_manual_links_global_install_or_audit_fix: false,
  Windows_native_CLI_prepare_run_probe_seal_verifyUpload_extra_VM_or_OSPID_execution: false,
  independent_acceptance: false, CI_or_push_or_production_authorized_or_performed: false, release_ready: false
};
fs.writeFileSync(join(report, 'development-summary.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(evidence, null, 2));
