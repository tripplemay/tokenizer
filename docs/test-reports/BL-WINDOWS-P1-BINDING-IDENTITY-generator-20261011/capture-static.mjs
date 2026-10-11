import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-binding-identity-generator-20261011';
const report = join(repo, 'docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-generator-20261011');
const own = '/Volumes/ORICO/project/.wp1cbg-20261011';
const source = '221f2f87d94db1656e3000662796d79621b696f5';
const start = '88d07004466251be3076fc454699207d3879374f';
const phase = process.argv[2];
assert(['precommit', 'postcommit', 'postdevelopment'].includes(phase));
assert.equal(resolve('.'), repo);
assert.equal(process.env.HOME, own);
assert.equal(process.env.USERPROFILE, own);
const output = join(report, `${phase}.raw.json`);
assert(!fs.existsSync(output), 'never overwrite a capture');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const meta = (path, bytes) => ({ path, bytes: bytes.length, sha256: sha(bytes) });
const commands = [];
const result = { format: 'windows-p1-C002-generator-static-capture-v1', phase,
  observed_at_utc: new Date().toISOString(), role: 'supporting Generator; not independent acceptance',
  source, start, env: Object.fromEntries(['HOME', 'USERPROFILE', 'TMPDIR', 'PATH',
    'XDG_CACHE_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].map(k => [k, process.env[k]])) };
function git(args) {
  const a = ['-c', 'core.fileMode=false', ...args];
  const r = cp.spawnSync('/usr/bin/git', a, { cwd: repo, env: process.env, maxBuffer: 128 * 1024 * 1024 });
  commands.push({ command: '/usr/bin/git', args: a, cwd: repo, status: r.status, signal: r.signal,
    stdout: meta('stdout', r.stdout ?? Buffer.alloc(0)), stderr: (r.stderr ?? Buffer.alloc(0)).toString(),
    error: r.error?.code ?? null });
  assert.equal(r.status, 0, `git ${args[0]}`);
  assert(!r.error && r.signal === null);
  return r.stdout;
}
const rows = ref => git(['ls-tree', '-r', ref]).toString().trimEnd().split('\n');
const maps = rows => new Map(rows.map(row => [row.slice(row.indexOf('\t') + 1), row]));
function disk(path) {
  const stat = fs.lstatSync(join(repo, path));
  assert(stat.isFile(), `regular tracked file: ${path}`);
  return fs.readFileSync(join(repo, path));
}
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, 'unique projection target');
  return text.replace(before, after);
}
try {
  result.head = git(['rev-parse', 'HEAD']).toString().trim();
  if (phase === 'precommit') assert.equal(result.head, start);
  result.branch = git(['branch', '--show-current']).toString().trim();
  assert.equal(result.branch, 'codex/windows-p1-binding-identity-generator-20261011');
  const rawPath = 'docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-plan-20261011/probes.raw.json';
  const rawBytes = disk(rawPath);
  assert.equal(sha(rawBytes), 'd445ff00e28ed8529234264559df3128e9b1be81dc5856ea7cf5579a8af502f4');
  const raw = JSON.parse(rawBytes);
  const proposal = JSON.parse(disk('docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-plan-20261011/proposal.json'));
  const pre = JSON.parse(disk('docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-pre-scope-20261011/verdict.json'));
  assert.equal(pre.verdict, 'PASS_SCOPE_ONLY');
  const authorityPath = 'docs/test-reports/BL-RELEASE-READINESS-coordination-20261011/windows-binding-identity-generator-adjudication.json';
  const authorityBytes = fs.readFileSync(join('/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008', authorityPath));
  assert(authorityBytes.equals(git(['show', `d071207:${authorityPath}`])));
  const authority = JSON.parse(authorityBytes);
  assert.equal(authority.generator.authorized, true);
  assert.equal(authority.generator.start_commit, start);
  assert.equal(authority.generator.worktree, repo);
  result.authority = meta(authorityPath, authorityBytes);
  result.frozen_reports = [...pre.planner_inputs,
    { path: 'docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-pre-scope-20261011/verdict.json', sha256: 'dae79f5098bd0cc6bfd1748a2ad16e5588c85963a192fb16c81ba8dd6221b317' },
    { path: 'docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-pre-scope-20261011/README.md', sha256: '272df9f849640c5c2ddb2afd738b9bff5a84cd9cc9e03e3655ba42a12ae3003f' }
  ].map(x => { const b = disk(x.path); assert.equal(sha(b), x.sha256); return meta(x.path, b); });
  const originals = raw.projection.changes.map(c => [c.path, git(['show', `${source}:${c.path}`])]);
  const paths = originals.map(([path]) => path);
  const projected = new Map();
  for (const change of raw.projection.changes) {
    const old = originals.find(([p]) => p === change.path)[1];
    let text = old.toString();
    for (const r of change.replacements ?? []) text = replaceOnce(text, r.before, r.after);
    if (change.append) text += change.append;
    for (const r of change.identityLiteralReplacementsOnly ?? []) text = replaceOnce(text, r.before, r.after);
    const expected = Buffer.from(text);
    const actual = disk(change.path);
    assert(actual.equals(expected), `exact projected bytes: ${change.path}`);
    const frozen = raw.projection.candidateHashes.find(x => x.path === change.path);
    assert.equal(actual.length, frozen.bytes);
    assert.equal(sha(actual), frozen.sha256);
    assert.equal(sha(actual), authority.generator.projected_hashes[change.path]);
    projected.set(change.path, actual);
  }
  result.projection = [...projected].map(([p, b]) => meta(p, b));
  const cliPath = paths[3];
  const mask = b => b.toString().replace(/(const (?:bindingHash|mdHash) = ')[a-f0-9]{64}(';)/g, '$1' + '_'.repeat(64) + '$2');
  assert.equal(mask(originals[3][1]), mask(projected.get(cliPath)));
  result.cli_only_two_identity_literals = true;
  const mdOld = originals[2][1], mdNew = projected.get(paths[2]);
  assert(mdOld.equals(mdNew.subarray(0, mdOld.length)));
  result.markdown_original_prefix_preserved = true;
  const oldJson = JSON.parse(originals[1][1]), newJson = JSON.parse(projected.get(paths[1]));
  assert.deepEqual(Object.keys(oldJson).filter(k => JSON.stringify(oldJson[k]) !== JSON.stringify(newJson[k])),
    ['revision', 'updated_at_utc', 'revision_scope', 'workflow']);
  assert.deepEqual(Object.keys(oldJson.workflow).filter(k => JSON.stringify(oldJson.workflow[k]) !== JSON.stringify(newJson.workflow[k])), ['checkout_env']);
  result.changed_json_keys = ['revision', 'updated_at_utc', 'revision_scope', 'workflow.checkout_env'];
  const sourceRows = rows(source), startRows = rows(start), headRows = rows(result.head);
  const sm = maps(sourceRows), im = maps(startRows), hm = maps(headRows);
  assert.equal(sourceRows.length, 2457);
  assert.equal(startRows.length, 2463);
  for (const [p, row] of sm) assert.equal(im.get(p), row, `start source row: ${p}`);
  const additions = startRows.filter(row => !sm.has(row.slice(row.indexOf('\t') + 1)));
  assert.equal(additions.length, 6);
  result.start_additions = additions;
  for (const [p, row] of im) {
    const actual = disk(p);
    const [, type, object] = row.slice(0, row.indexOf('\t')).split(' ');
    assert.equal(type, 'blob');
    if (!paths.includes(p)) assert.equal(blob(actual), object, `frozen whole-tree bytes: ${p}`);
    if (phase !== 'precommit') {
      assert.equal(hm.get(p).slice(0, 12), row.slice(0, 12), `mode/type: ${p}`);
      assert.equal(hm.get(p).split('\t')[0].split(' ')[2], blob(actual));
    }
  }
  assert.equal(headRows.length, startRows.length);
  result.whole_tree = { source_entries: sourceRows.length, start_entries: startRows.length,
    disk_entries_checked: startRows.length, all_other_raw_blob_ids_unchanged: true,
    all_tracked_modes_and_types_preserved: true, source_inventory_sha256: sha(Buffer.from(sourceRows.join('\n') + '\n')),
    start_inventory_sha256: sha(Buffer.from(startRows.join('\n') + '\n')),
    head_inventory_sha256: sha(Buffer.from(headRows.join('\n') + '\n')) };
  result.ten_inputs = raw.frozenInputs.map(x => {
    const actual = disk(x.path), src = git(['show', `${source}:${x.path}`]);
    assert(actual.equals(src)); assert.equal(sha(actual), x.sha256);
    assert(src.equals(git(['show', `${raw.predecessor}:${x.path}`])));
    return meta(x.path, actual);
  });
  const archiveRoot = 'docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/';
  const archiveRows = sourceRows.filter(row => row.includes('\t' + archiveRoot));
  assert.equal(archiveRows.length, 57);
  const archiveInventoryHash = sha(Buffer.from(archiveRows.join('\n') + '\n'));
  assert.equal(archiveInventoryHash, 'cb15965730dad49aa8d1f138ef0014eff975b96447c93f2e866e9e39721548b3');
  result.original_archive = { root: archiveRoot, inventory_sha256: archiveInventoryHash,
    entries: archiveRows.map(row => {
      const p = row.slice(row.indexOf('\t') + 1), actual = disk(p), src = git(['show', `${source}:${p}`]);
      assert(actual.equals(src)); assert.equal(hm.get(p), row); return meta(p, actual);
    }) };
  result.original_test = meta('tests/diagnostics/windows-p1-stages.test.ts', disk('tests/diagnostics/windows-p1-stages.test.ts'));
  assert.equal(result.original_test.sha256, '7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132');
  result.parent_original_receipts = proposal.original_receipts.entries.map(x => {
    const b = fs.readFileSync(join(proposal.original_receipts.directory, x.path));
    assert.equal(b.length, x.bytes); assert.equal(sha(b), x.sha256); return meta(x.path, b);
  });
  const changed = git(['diff', '--name-only', start]).toString().trim().split('\n').filter(Boolean);
  if (phase === 'precommit') assert.deepEqual(changed.sort(), [...paths].sort());
  else assert.equal(git(['diff', '--name-only']).length, 0);
  result.source_delta_from_start = changed;
  if (phase !== 'precommit') {
    result.commit_paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', result.head]).toString().trim().split('\n');
    assert.deepEqual([...result.commit_paths].sort(), [...paths].sort());
  }
  const diff = git(['diff', start, '--', ...paths]);
  fs.writeFileSync(join(report, `${phase}.source.diff`), diff, { flag: 'wx' });
  result.diff = meta(`${phase}.source.diff`, diff);
  result.status = git(['status', '--short', '--untracked-files=all']).toString();
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  result.commands = commands;
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ phase, ok: result.ok, head: result.head,
    projection: result.projection, whole_tree: result.whole_tree, failure: result.failure }));
}
