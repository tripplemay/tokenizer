import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDS, SOURCE_FREEZE, NATIVE_SCRIPT } from '../native-runtime-parity.mjs';

assert(process.version.startsWith('v22.') && process.platform === 'darwin', 'local Node22 static controls only');
const here = fileURLToPath(new URL('.', import.meta.url)), repo = resolve(here, '../../../..');
const prefix = 'docs/test-reports/windows-release-diagnosis-20261008/';
const r1 = '5ab1c93894aebcfb2ffad50604e942a10c3655f7';
const scopeBase = '846e8e07614a97dcebd9d2cd2bdb678f971651fd';
const read = (path) => fs.readFileSync(join(repo, path));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashed = (path) => ({ path, sha256: sha(read(path)), bytes: read(path).length });
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
const cli = prefix + 'native-runtime-parity.mjs', own = prefix + 'parity-generator-r2/';
const paths = git(['diff', '--name-only', r1]).split('\n').filter(Boolean);
assert(paths.every((path) => path === cli || path.startsWith(own)));
const frozen = ['src', 'tests', 'app', 'prisma', 'package.json', 'package-lock.json', 'progress.json', 'features.json', 'backlog.json',
  '.github/workflows', 'docs/specs', prefix + 'native-diagnostics.mjs', prefix + 'trace-preload.mjs',
  prefix + 'native-findings-r1', prefix + 'parity-generator-r1'];
assert.equal(git(['diff', r1, '--', ...frozen]), '');
const proofInventory = frozen.map((path) => ({ path, r1GitObject: git(['rev-parse', r1 + ':' + path]),
  currentCommittedGitObject: git(['rev-parse', 'HEAD:' + path]) }));
assert(proofInventory.every((entry) => entry.r1GitObject === entry.currentCommittedGitObject));
const original = JSON.parse(read(prefix + 'native-findings-r1/analysis.json')).evidenceInventory;
assert.equal(original.length, 32);
const originalEvidenceInventory = original.map((entry) => {
  const actual = hashed(prefix + 'native-findings-r1/' + entry.path);
  assert.equal(actual.sha256, entry.sha256); return actual;
});
const criticInputInventory = ['verdict.json', 'controls.mjs', 'controls.json'].map((name) => hashed(prefix + 'parity-scope-r1/' + name));
assert.equal(sha(read(own + 'r1-reproduction.mjs')), criticInputInventory.find((entry) => entry.path.endsWith('controls.mjs')).sha256);
const oldVerdict = JSON.parse(read(prefix + 'parity-scope-r1/verdict.json'));
assert.equal(oldVerdict.violation, true);
const reproduction = JSON.parse(read(own + 'r1-reproduction.json'));
assert.equal(reproduction.scriptSha256, sha(Buffer.from(git(['show', r1 + ':' + cli]) + '\n')));
assert.equal(reproduction.violation, true); assert.equal(reproduction.controlExecutionFailure, false);
assert.deepEqual(reproduction.controls.filter((item) => item.passed === false).map((item) => item.id.slice(0, 3)), ['C06', 'C07', 'C08', 'C09']);
const controls = JSON.parse(read(own + 'controls.json'));
assert.equal(controls.role, 'supporting-generator-r2-controls-not-independent-verdict');
assert.equal(controls.controls.length, 14);
assert(controls.controls.every((item) => item.execution === 'completed' && item.passed === true && item.violation === false));
assert.equal(controls.scriptSha256, sha(read(cli)));
assert.equal(controls.controlExecutionFailure, false); assert.equal(controls.violation, false);
assert.equal(controls.nativeWindowsExecuted, false); assert.equal(controls.productRuntimeExecuted, false);
const product = read('src/cli/replay.ts').toString();
assert.equal(NATIVE_SCRIPT, JSON.parse(product.match(/const script = ("[^\n]+?");/)[1]));
assert.deepEqual(BOUNDS, { totalMs: 600000, caseMs: 40000, cleanupMs: 3000, operationMs: 10000,
  smokeChildMs: 7000, smokePs: 38, totalPs: 76, outputBytes: 65536, traceBytes: 524288, attributeBytes: 16384 });
for (const path of [cli, own + 'controls.mjs', own + 'checks.mjs', own + 'r1-reproduction.mjs'])
  execFileSync(process.execPath, ['--check', join(repo, path)], { maxBuffer: 4096 });
const checks = { schemaVersion: 1, role: 'supporting-generator-r2-static-checks', sourceFreezeHead: SOURCE_FREEZE,
  r1BaseHead: r1, scopeBaseHead: scopeBase, checkedHead: git(['rev-parse', 'HEAD']), node: process.version,
  platform: process.platform, nativeWindowsExecuted: false, productRuntimeExecuted: false, syntaxChecks: 4,
  schemaValidated: true, finalControls: controls.controls.length, allControlsPassed: true, bounds: BOUNDS,
  nativeAttributeScriptExact: true, frozenPathsUnchanged: true, workflowUnchangedFromR1: true,
  originalEvidenceInventory, criticInputInventory, proofInventory, releaseAcceptance: false, releaseReady: false };
const require = createRequire(import.meta.url), Ajv = require('/Volumes/ORICO/project/tokenizer/node_modules/ajv');
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(read(own + 'checks.schema.json')));
assert(validate(checks), JSON.stringify(validate.errors));
fs.writeFileSync(join(here, 'local-checks.json'), JSON.stringify(checks, null, 2) + '\n');
const artifacts = [cli, ...fs.readdirSync(here).filter((name) => name !== 'handoff.json').sort().map((name) => own + name)].map(hashed);
const handoff = { schemaVersion: 1, role: 'supporting-generator-r2-handoff', sourceFreezeHead: SOURCE_FREEZE,
  r1BaseHead: r1, scopeBaseHead: scopeBase, checkedHead: checks.checkedHead,
  postCommitIndependentScopeReviewRequired: true, nativeWindowsExecuted: false, productRuntimeExecuted: false,
  workflowUnchangedFromR1: true, artifacts, originalEvidenceInventory, criticInputInventory, proofInventory,
  releaseAcceptance: false, releaseReady: false };
fs.writeFileSync(join(here, 'handoff.json'), JSON.stringify(handoff, null, 2) + '\n');
console.log(JSON.stringify({ syntaxChecks: 4, schemaValidated: true, controls: 14, originalEvidenceHashesVerified: 32,
  readonlyCriticInputsHashed: 3, artifactsHashed: artifacts.length, sourceSha256: sha(read(cli)),
  nativeWindowsExecuted: false, productRuntimeExecuted: false, releaseAcceptance: false }));
