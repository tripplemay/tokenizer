import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-prepare-observation-generator-20261011';
const report = join(repo, 'docs/test-reports/BL-WINDOWS-P1-PREPARE-OBSERVATION-generator-20261011');
const entries = [];
const visit = directory => {
  for (const row of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, row.name);
    assert(!row.isSymbolicLink());
    if (row.isDirectory()) visit(path);
    else {
      assert(row.isFile());
      const bytes = fs.readFileSync(path), rel = relative(repo, path);
      const ignored = cp.spawnSync('git', ['-c', 'core.fileMode=false', 'check-ignore', '-q', '--', rel], { cwd: repo, env: process.env });
      assert([0, 1].includes(ignored.status)); assert.equal(ignored.stderr.length, 0);
      entries.push({ path: rel, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ignored_requires_exact_force_add: ignored.status === 0 });
    }
  }
};
assert(!fs.existsSync(join(report, 'artifact-manifest.json')));
visit(report);
const manifest = {
  format: 'windows-p1-prepare-observation-generator-artifact-manifest-v1',
  source_commit: '712cf210b089dc71f3a6e6ed2e19e1de7fee57da',
  source_sha256: 'c245a528fb8549915396b5f052bf3841f35b03d88d6b7b5e91982b6f0f07dc4f',
  self_excluded: true, scope: relative(repo, report) + '/', entries,
  exact_ignored_force_add_paths: entries.filter(row => row.ignored_requires_exact_force_add).map(row => row.path),
  raw_streams_and_npm_debug_untrimmed: true, independent_acceptance: false, release_ready: false
};
fs.writeFileSync(join(report, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ artifacts_except_manifest: entries.length, ignored_force_add: manifest.exact_ignored_force_add_paths.length,
  manifest_sha256: createHash('sha256').update(fs.readFileSync(join(report, 'artifact-manifest.json'))).digest('hex') }, null, 2));
