import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const mode = process.argv[2];
assert(['before', 'after', 'source', 'final'].includes(mode));
const source = '888a5acd7a8a441c9ec4ad898453f149cf8d6b7c';
const base = '54af183617ed06c18edd42632326dbfd09451456';
const report = 'docs/test-reports/BL-WINDOWS-P1-CHECKOUT-generator-20261011/';
const planPath = 'docs/test-reports/BL-WINDOWS-P1-CHECKOUT-plan-20261011/proposal.json';
const plan = JSON.parse(fs.readFileSync(planPath));
const revision = plan.contract_revision_required;
const paths = revision.later_generator_allowed_existing_paths;
const sha = b => createHash('sha256').update(b).digest('hex');
const git = (...args) => execFileSync('git', ['-c', 'core.fileMode=false', ...args], { maxBuffer: 64 * 1024 * 1024 });
const text = (...args) => git(...args).toString('utf8').trim();
const old = p => git('show', `${source}:${p}`);
const read = p => fs.readFileSync(p);
const tree = (ref, path) => git('ls-tree', '-rz', '--full-tree', ref, ...(path ? ['--', path] : []));
const records = b => b.toString().split('\0').filter(Boolean).map(line => ({ line, path: line.split('\t')[1] }));
const replace = (s, before, after) => {
  assert.equal(s.split(before).length - 1, 1, 'exactly one specified replacement');
  return s.replace(before, after);
};
const summary = { mode, source, base, head: text('rev-parse', 'HEAD'), checks: [] };
const check = (name, fn) => { fn(); summary.checks.push(name); };

check('authority-and-planner-identity', () => {
  const parent = '/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008';
  const path = 'docs/test-reports/BL-RELEASE-READINESS-coordination-20261011/windows-checkout-plan-and-generator-adjudication.json';
  const disk = fs.readFileSync(`${parent}/${path}`);
  assert(disk.equals(git('-C', parent, 'show', `77b00b16e5490db4bd2f860209d8e30b601cb2c4:${path}`)));
  const authority = JSON.parse(disk);
  assert.equal(authority.generator_authority.authorized, true);
  assert.equal(authority.generator_authority.base, base);
  assert.deepEqual(authority.generator_authority.existing_paths, paths);
  assert.equal(sha(read(planPath)), authority.planner.proposal_sha256);
  assert.equal(sha(read('docs/test-reports/BL-WINDOWS-P1-CHECKOUT-plan-20261011/README.md')), authority.planner.readme_sha256);
  assert.equal(sha(read('docs/test-reports/BL-WINDOWS-P1-CHECKOUT-pre-scope-20261011/verdict.json')), authority.fresh_pre_scope.verdict_sha256);
  assert.equal(sha(read('docs/test-reports/BL-WINDOWS-P1-CHECKOUT-pre-scope-20261011/README.md')), authority.fresh_pre_scope.readme_sha256);
  assert.equal(authority.fresh_pre_scope.verdict, 'PASS_SCOPE_ONLY');
});
check('source888-inventory-and-frozen-inputs', () => {
  const inventory = tree(source);
  assert.equal(sha(inventory), plan.path_inventory.raw_nul_sha256);
  assert.equal(records(inventory).length, 2453);
  for (const input of [...plan.source_hashes, ...plan.verified_frozen_inputs]) {
    assert.equal(sha(old(input.path)), input.sha256, input.path);
    if (!paths.includes(input.path) || mode === 'before') assert.equal(sha(read(input.path)), input.sha256, input.path);
  }
  summary.sourceInventory = { paths: records(inventory).length, sha256: sha(inventory) };
});
check('original-failure-immutable', () => {
  const originals = plan.failure_evidence.files.map(file => {
    const b = fs.readFileSync(`${plan.failure_evidence.root}/${file.path}`);
    assert.equal(b.length, file.bytes);
    assert.equal(sha(b), file.sha256);
    if (file.lines) assert.equal(b.toString().split('\n').filter(Boolean).length, file.lines);
    return { ...file };
  });
  summary.originalFailure = originals;
});
check('archive57-tree-and-materialized-bytes', () => {
  const archive = 'docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original';
  const originalTree = tree(source, archive), currentTree = tree('HEAD', archive);
  assert.equal(sha(originalTree), '52ac3b835b45e6aa3c54ea72f57180421822c5719d2a9e9bca0d2abbbf0a0721');
  assert.equal(records(originalTree).length, 57);
  assert(originalTree.equals(currentTree));
  for (const { path } of records(originalTree)) {
    assert(fs.lstatSync(path).isFile());
    assert(read(path).equals(old(path)), path);
  }
  summary.archive57 = { paths: 57, sha256: sha(originalTree), materializedBytesIdentical: true };
});
check('base-is-source888-plus-exact-four-docs', () => {
  const a = new Map(records(tree(source)).map(r => [r.path, r.line]));
  const b = new Map(records(tree(base)).map(r => [r.path, r.line]));
  for (const [path, line] of a) assert.equal(b.get(path), line, path);
  const added = [...b.keys()].filter(p => !a.has(p));
  assert.equal(added.length, 4);
  assert(added.every(p => /^docs\/test-reports\/BL-WINDOWS-P1-CHECKOUT-(plan|pre-scope)-20261011\/(README\.md|proposal\.json|verdict\.json)$/.test(p)));
  summary.baseAdditionalReportPaths = added;
});
check('exact-four-file-projection-and-two-masked-literals', () => {
  let workflow = old(paths[0]).toString();
  const delta = plan.selected_solution.workflow_delta;
  workflow = replace(workflow, delta.before, delta.after);
  let json = old(paths[2]).toString();
  for (const change of revision.binding_json_replacements) json = replace(json, change.before, change.after);
  const md = old(paths[1]).toString() + revision.binding_md_append;
  let cli = old(paths[3]).toString();
  for (const change of revision.cli_identity_replacements) {
    const value = change.constant === 'bindingHash' ? sha(json) : sha(md);
    cli = replace(cli, `const ${change.constant} = '${change.old}';`, `const ${change.constant} = '${value}';`);
  }
  const projected = [workflow, md, json, cli].map(s => Buffer.from(s));
  const expectedHashes = revision.proposed_byte_hashes;
  assert.deepEqual(projected.map(sha), [expectedHashes.workflow, expectedHashes.bindings_md, expectedHashes.bindings_json, expectedHashes.cli_hash_literals_only]);
  for (const [i, path] of paths.entries()) assert(read(path).equals(mode === 'before' ? old(path) : projected[i]), path);
  const mask = s => {
    for (const name of ['bindingHash', 'mdHash']) {
      const re = new RegExp(`(const ${name} = ')[a-f0-9]{64}(';)`, 'g');
      assert.equal([...s.matchAll(re)].length, 1);
      s = s.replace(re, '$1' + '0'.repeat(64) + '$2');
    }
    return s;
  };
  assert.equal(mask(read(paths[3]).toString()), mask(old(paths[3]).toString()));
  summary.fileHashes = paths.map(path => ({ path, bytes: read(path).length, sha256: sha(read(path)) }));
  summary.cliOtherBytesIdentical = true;
});
check('all-other-mode-type-path-blob-records-identical', () => {
  const a = new Map(records(tree(base)).map(r => [r.path, r.line]));
  const b = new Map(records(tree('HEAD')).map(r => [r.path, r.line]));
  for (const [path, line] of a) if (!paths.includes(path)) assert.equal(b.get(path), line, path);
  for (const path of b.keys()) if (!a.has(path)) assert(path.startsWith(report), path);
  const changed = text('diff', '--name-only', base, ...(mode === 'before' || mode === 'after' ? [] : ['HEAD'])).split('\n').filter(Boolean);
  const code = changed.filter(p => !p.startsWith(report));
  assert.deepEqual(code, mode === 'before' ? [] : [...paths].sort());
  summary.changedPathsFromBase = changed;
  summary.allOtherRecordsIdentical = true;
});
if (mode === 'source' || mode === 'final') check('exact-source-commit', () => {
  const candidate = mode === 'source' ? text('rev-parse', 'HEAD') : text('rev-parse', 'HEAD^');
  assert.equal(text('rev-parse', `${candidate}^`), base);
  assert.deepEqual(text('diff-tree', '--no-commit-id', '--name-only', '-r', candidate).split('\n').filter(Boolean), [...paths].sort());
  summary.sourceCommit = candidate;
  summary.sourceCommitParent = base;
  if (mode === 'final') {
    const changed = text('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').filter(Boolean);
    assert(changed.length && changed.every(p => p.startsWith(report)));
    assert.equal(text('status', '--porcelain'), '');
    assert.equal(text('diff', '--cached', '--name-only'), '');
    summary.finalClean = true;
    summary.indexEmpty = true;
  }
});
console.log(JSON.stringify(summary, null, 2));
