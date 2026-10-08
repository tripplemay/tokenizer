import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const feature = process.argv[2];
if (!['F001', 'F002', 'final', 'final-rerun'].includes(feature)) throw new Error('F001, F002, final or final-rerun required');
const dir = 'docs/test-reports/BL-RELEASE-READINESS-generator-20261008';
const git = (...args) => execFileSync('git', args);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync('docs/test-reports/BL-RELEASE-READINESS-inputs-20261008/source-manifest.json'));
const isFinal = feature.startsWith('final');
const features = isFinal ? ['F001', 'F002'] : [feature];
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
let frozen_inventory;
if (isFinal) {
  const rows = git('ls-tree', '-r', '58266af').toString().trim().split('\n').map((line) => {
    const [metadata, path] = line.split('\t'), [mode, type, blob] = metadata.split(' ');
    return { path, mode, type, blob };
  }).filter((row) => row.type === 'blob');
  const actual = execFileSync('git', ['hash-object', '--stdin-paths'], { input: `${rows.map((row) => row.path).join('\n')}\n` })
    .toString().trim().split('\n');
  const exceptions = new Set(['.github/workflows/deploy-vps.yml', 'src/cli/service.ts', 'scripts/deploy-vps-release.sh', 'tests/server/release-rehearsal.test.ts',
    'tests/server/release-image.test.ts', 'docs/specs/BL-RELEASE-READINESS-spec.md', 'progress.json', 'features.json']);
  frozen_inventory = rows.map((row, index) => ({ ...row, actual_blob: actual[index], identical: row.blob === actual[index],
    authorized_mutable_path: exceptions.has(row.path) }));
  writeFileSync(`${dir}/${feature}-frozen-input-paths.json`, `${JSON.stringify(frozen_inventory, null, 2)}\n`, { flag: 'wx' });
}
const new_sources = isFinal ? ['.github/workflows/deploy-vps.yml', 'scripts/ci/vps-host-preflight.sh',
  'tests/ci/vps-host-preflight.test.ts', 'tests/server/release-predecessor-negative.test.ts'].map((path) => ({ path,
    sha256: digest(readFileSync(path)), git_blob: git('hash-object', path).toString().trim() })) : undefined;
writeFileSync(`${dir}/${feature}-provenance.json`, `${JSON.stringify({
  kind: 'generator_source_path_hash_provenance_not_acceptance', baseline: git('rev-parse', '58266af').toString().trim(),
  current_head_before_commit: git('rev-parse', 'HEAD').toString().trim(), generated_at: new Date().toISOString(),
  files, preservation, new_sources, tracked_changes_from_baseline: changes,
  frozen_inventory: frozen_inventory ? { path: `${feature}-frozen-input-paths.json`, total: frozen_inventory.length,
    unauthorized_changes: frozen_inventory.filter((row) => !row.identical && !row.authorized_mutable_path),
    declared_changes: frozen_inventory.filter((row) => !row.identical && row.authorized_mutable_path).map((row) => row.path) } : undefined,
  workflow_transport: 'Selective macOS job/needs plus predecessor guards and operation-separated host inventory; B06/B07 env/probes and floor15 retained.',
  limits: 'Byte/source provenance and local command records only; no independent acceptance or release readiness.'
}, null, 2)}\n`, { flag: 'wx' });
