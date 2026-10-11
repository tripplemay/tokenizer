import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-binding-identity-generator-20261011';
const base = 'docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-generator-20261011';
const report = join(repo, base);
assert.equal(resolve('.'), repo);
assert.equal(process.env.HOME, '/Volumes/ORICO/project/.wp1cbg-20261011');
const read = name => JSON.parse(fs.readFileSync(join(report, name)));
const write = (name, value) => fs.writeFileSync(join(report, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = b => createHash('sha256').update(b).digest('hex');
const initial = read('development.raw.json');
const development = read('development-after-local-preflight.raw.json');
const post = read('postdevelopment.raw.json');
const dependency = read('dependency-provenance.raw.json');
assert.equal(initial.ok, false);
assert.equal(initial.install_attempts, 0);
assert.equal(development.install_attempts, 1);
assert.equal(development.original81.numPassedTests, 81);
assert.equal(development.original81.numFailedTests, 0);
assert.equal(development.original81.numPendingTests, 0);
assert.equal(development.original81.numTodoTests, 0);
assert.equal(post.ok, true);
assert.equal(dependency.ok, true);
const git = args => {
  const r = cp.spawnSync('/usr/bin/git', ['-c', 'core.fileMode=false', ...args], { cwd: repo, env: process.env });
  assert.equal(r.status, 0); return r.stdout.toString();
};
const source = git(['rev-parse', 'HEAD']).trim();
assert.equal(source, '61cf64e67a6fda231bb090e77c19d5ececb908af');
assert.equal(git(['diff', '--name-only']).trim(), '');
const result = {
  format: 'windows-p1-C002-supporting-generator-development-handoff-v1',
  observed_at_utc: new Date().toISOString(),
  outcome: 'EXACT_C002_IMPLEMENTED_SCOPED_DEVELOPMENT_COMPLETED_WITH_RETAINED_INSTALL_AND_OPERATIONAL_LIMITATIONS',
  role: 'supporting Generator; section 1.5; not independent Evaluator/Coordinator',
  source, source_tree: git(['rev-parse', 'HEAD^{tree}']).trim(), source_parent: git(['rev-parse', 'HEAD^']).trim(),
  source_commit_paths: post.commit_paths, projected_file_hashes: post.projection,
  report_commit: 'Separate later report-only local commit; SHA supplied at handoff to avoid self-reference',
  report_path: base,
  frozen_tree_proof: post.whole_tree, frozen_inputs: post.ten_inputs,
  original_archive: { root: post.original_archive.root, entries: post.original_archive.entries.length,
    inventory_sha256: post.original_archive.inventory_sha256, raw_hashes: 'postdevelopment.raw.json#/original_archive/entries' },
  original_test: post.original_test, parent_original_receipts: post.parent_original_receipts,
  initial_driver_failure: { status: read('00-development-driver.status.json').status,
    install_attempts: initial.install_attempts, failure: initial.failure,
    first_script: 'development.initial.mjs', output: 'development.raw.json', source_or_assertions_changed: false },
  development_checks: development.commands, original81: development.original81,
  runtime_env: development.env, no_ambient_credentials_inherited: true,
  dependency_provenance: { vendor_link: dependency.vendor_link, vendor_files: dependency.vendor_files.length,
    installed_symlinks: dependency.all_installed_symlinks.length,
    all_targets_inside_owned_worktree: dependency.no_installed_symlink_target_outside_owned_worktree },
  authorization_order: dependency.authorization_order,
  install_limitations: dependency.install_limitations,
  lifecycle_requests: { npm_debug_originals: dependency.owned_npm_debug_originals,
    package_reference_capture: '04-package-lifecycle-references.json',
    public_binary_host_requests_directly_instrumented: false, full_egress_isolation: false },
  operational_path_errors: [
    { path: join(repo, 'development.tmp'), bytes: 85,
      sha256: '2ab096a8df3c5946189e3fedc602b0644d3e5502be4d9c1d3fe27871f04d8217',
      kind: 'accidental untracked report draft outside reportdir; no source/state/original/parent edits',
      recovery: 'size/hash captured then absolute apply_patch deletion; not committed' },
    { path: join(repo, 'capture-dependency-provenance.tmp'), bytes: 87,
      sha256: 'a0408d9317f96e067f78eef65f6c3706cad3ee7a9a64dcb658e8f1b68d6eddee',
      kind: 'accidental untracked report draft outside reportdir; no source/state/original/parent edits',
      recovery: 'size/hash captured then absolute apply_patch deletion; git diff --exit-code=0; not committed' }
  ],
  untouched: ['original tests/assertions/raw hash guards/normalization policy', 'B001/E0/API/worker/native env allowlist',
    'eleven sources/sixteen uploads/selection/caps/bounds/commands/permissions/Secrets/retry',
    'Actions v4/Node22/archive/ten inputs/all other tracked bytes and modes',
    'Compose HARD_STOP/no third Compose', 'deferred keys/backup/recovery/baseline/password',
    'progress/features/pending_gate/memory/registry/harness'],
  acceptance: { independent_scope: false, different_family_Kimi: false, Windows_checkout_bytes: false,
    INITIAL_native: false, functionality: false, F004_F005_closed: false, release_ready: false },
  publication: { worker_push: false, source_integrated_into_parent_runtime: false, CI_or_native_run: false,
    main_or_prod: false, human_gate_decision: false },
  next: ['Fresh independent actual-diff/post-scope', 'Different-family Kimi supporting gate',
    'Only separate Coordinator ruling may authorize new exact-source non-main publication/native opportunity; no retry'],
  artifact_manifest: 'artifact-manifest.json; includes all report files except the manifest itself'
};
write('generator-report.json', result);
const files = fs.readdirSync(report).filter(n => n !== 'artifact-manifest.json').sort().map(name => {
  const path = join(report, name); assert(fs.statSync(path).isFile());
  const b = fs.readFileSync(path); return { path: base + '/' + name, bytes: b.length, sha256: sha(b) };
});
write('artifact-manifest.json', { format: 'windows-p1-C002-generator-added-report-artifacts-v1', source,
  observed_at_utc: new Date().toISOString(), report_path: base, entries: files,
  self_reference_excluded: true, own_hash_supplied_at_handoff: true });
console.log(JSON.stringify({ source, source_tree: result.source_tree,
  report_files: files.length + 1, original81: result.original81, commands: result.development_checks.map(r => ({ label: r.label, status: r.status })),
  report_sha256: sha(fs.readFileSync(join(report, 'generator-report.json'))),
  manifest_sha256: sha(fs.readFileSync(join(report, 'artifact-manifest.json'))) }));
