import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const feature = process.argv[2];
if (!['F001', 'F002', 'final'].includes(feature)) throw new Error('F001, F002 or final required');
const dir = 'docs/test-reports/BL-RELEASE-READINESS-generator-20261008';
const git = (...args) => execFileSync('git', args);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync('docs/test-reports/BL-RELEASE-READINESS-inputs-20261008/source-manifest.json'));
const features = feature === 'final' ? ['F001', 'F002'] : [feature];
const files = features.flatMap((id) => manifest[id].files.map(({ path, git_blob, mode }) => {
  const source = git('show', `${manifest[id].source}:${path}`);
  const actual = readFileSync(path);
  return { feature: id, path, source_sha: manifest[id].source, source_git_blob: git_blob, mode,
    source_sha256: digest(source), actual_sha256: digest(actual), identical: source.equals(actual),
    actual_git_blob: git('hash-object', path).toString().trim() };
}));
const changes = git('diff', '--name-only', '58266af').toString().trim().split('\n').filter(Boolean);
const frozen = ['package.json', 'package-lock.json', 'src/cli/queue.ts', 'prisma/schema.prisma'];
const preservation = frozen.map((path) => {
  const baseline = git('show', `58266af:${path}`), actual = readFileSync(path);
  return { path, baseline_sha256: digest(baseline), actual_sha256: digest(actual), identical: baseline.equals(actual) };
});
writeFileSync(`${dir}/${feature}-provenance.json`, `${JSON.stringify({
  kind: 'generator_source_path_hash_provenance_not_acceptance', baseline: git('rev-parse', '58266af').toString().trim(),
  current_head_before_commit: git('rev-parse', 'HEAD').toString().trim(), generated_at: new Date().toISOString(),
  files, preservation, tracked_changes_from_baseline: changes,
  workflow_transport: 'Selective macOS job/needs plus predecessor guards; B06/B07 env/probes and floor15 retained.',
  limits: 'Byte/source provenance and local command records only; no independent acceptance or release readiness.'
}, null, 2)}\n`, { flag: 'wx' });
