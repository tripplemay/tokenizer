import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDS, SOURCE_FREEZE } from '../native-runtime-parity.mjs';

assert(process.version.startsWith('v22.') && process.platform === 'darwin');
const here = fileURLToPath(new URL('.', import.meta.url)), repo = resolve(here, '../../../..');
const prefix = 'docs/test-reports/windows-release-diagnosis-20261008/', own = prefix + 'parity-generator-r3/';
const base = 'd1df23737b49acabcb4c5823f75944b378b4e038', cli = prefix + 'native-runtime-parity.mjs';
const read = (path) => fs.readFileSync(join(repo, path));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashed = (path) => ({ path, sha256: sha(read(path)), bytes: read(path).length });
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1048576 }).trim();
assert(git(['diff', '--name-only', base]).split('\n').filter(Boolean).every((path) => path === cli || path.startsWith(own)));
const frozen = ['src', 'tests', 'app', 'prisma', 'package.json', 'package-lock.json', 'progress.json', 'features.json', 'backlog.json',
  '.github/workflows', 'docs/specs', prefix + 'native-diagnostics.mjs', prefix + 'trace-preload.mjs', prefix + 'native-findings-r1',
  prefix + 'parity-generator-r1', prefix + 'parity-generator-r2'];
assert.equal(git(['diff', base, '--', ...frozen]), '');
const proofInventory = frozen.map((path) => ({ path, baseGitObject: git(['rev-parse', base + ':' + path]),
  currentCommittedGitObject: git(['rev-parse', 'HEAD:' + path]) }));
assert(proofInventory.every((entry) => entry.baseGitObject === entry.currentCommittedGitObject));
const previous = JSON.parse(read(prefix + 'parity-generator-r2/handoff.json'));
for (const entry of [...previous.artifacts.filter((entry) => entry.path !== cli), ...previous.originalEvidenceInventory, ...previous.criticInputInventory])
  assert.equal(sha(read(entry.path)), entry.sha256);
const criticInputInventory = [...previous.criticInputInventory, ...fs.readdirSync(join(repo, prefix + 'parity-scope-r2')).sort()
  .map((name) => hashed(prefix + 'parity-scope-r2/' + name))];
assert.equal(sha(read(own + 'r2-reproduction.mjs')), criticInputInventory.find((entry) => entry.path === prefix + 'parity-scope-r2/controls.mjs').sha256);
assert.equal(JSON.parse(read(prefix + 'parity-scope-r2/verdict.json')).violation, true);
const reproduction = JSON.parse(read(own + 'controls-frozen-reproduction.json'));
assert.equal(reproduction.exactSource, base); assert.equal(reproduction.violation, true);
assert.equal(reproduction.controlExecutionFailure, false);
assert.deepEqual(reproduction.controls.filter((item) => !item.passed).map((item) => item.id), ['C11-parent-exported-return-metadata-value-boundary']);
const controls = JSON.parse(read(own + 'controls-draft-r3.json'));
assert.equal(controls.controlsPassed, true); assert.equal(controls.sourceScriptSha256, sha(read(cli)));
assert.equal(controls.controls[0].evidence.length, 11);
assert.equal(controls.nativeWindowsExecuted, false); assert.equal(controls.productRuntimeExecuted, false);
assert.deepEqual(BOUNDS, { totalMs: 600000, caseMs: 40000, cleanupMs: 3000, operationMs: 10000,
  smokeChildMs: 7000, smokePs: 38, totalPs: 76, outputBytes: 65536, traceBytes: 524288, attributeBytes: 16384 });
for (const path of [cli, own + 'controls.mjs', own + 'checks.mjs', own + 'r2-reproduction.mjs'])
  execFileSync(process.execPath, ['--check', join(repo, path)], { maxBuffer: 4096 });
const checks = { schemaVersion: 1, role: 'supporting-generator-r3-static-checks', r2BaseHead: base,
  sourceFreezeHead: SOURCE_FREEZE, checkedHead: git(['rev-parse', 'HEAD']), sourceSha256: sha(read(cli)),
  node: process.version, platform: process.platform, syntaxChecks: 4, schemaValidated: true, controlsPassed: true,
  rootMetadataCases: 11, frozenBoundariesUnchanged: true, originalHashesVerified: 32,
  criticFilesHashed: criticInputInventory.length, nativeWindowsExecuted: false, productRuntimeExecuted: false,
  releaseAcceptance: false, releaseReady: false };
const require = createRequire(import.meta.url), Ajv = require('/Volumes/ORICO/project/tokenizer/node_modules/ajv');
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(read(own + 'checks.schema.json')));
assert(validate(checks), JSON.stringify(validate.errors));
fs.writeFileSync(join(here, 'local-checks.json'), JSON.stringify(checks, null, 2) + '\n');
const artifacts = [cli, ...fs.readdirSync(here).filter((name) => name !== 'handoff.json').sort().map((name) => own + name)].map(hashed);
fs.writeFileSync(join(here, 'handoff.json'), JSON.stringify({ schemaVersion: 1, role: 'supporting-generator-r3-handoff',
  r2BaseHead: base, sourceFreezeHead: SOURCE_FREEZE, checkedHead: checks.checkedHead,
  postCommitIndependentScopeReviewRequired: true, artifacts, originalEvidenceInventory: previous.originalEvidenceInventory,
  criticInputInventory, proofInventory, nativeWindowsExecuted: false, productRuntimeExecuted: false,
  releaseAcceptance: false, releaseReady: false }, null, 2) + '\n');
console.log(JSON.stringify(checks));
