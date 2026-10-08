import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

assert(process.version.startsWith('v22.'), 'Node22 required');
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../..');
const parentDirectory = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-native-diagnostic-ci-20261008/docs/test-reports/windows-native-ci-20261008';
const read = (file) => readFileSync(join(here, file));
const parse = (file) => JSON.parse(read(file));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);
const Ajv = require('/Volumes/ORICO/project/tokenizer/node_modules/ajv');
const validate = new Ajv({ allErrors: true }).compile(parse('findings.schema.json'));
const findings = parse('findings.json');
assert(validate(findings), JSON.stringify(validate.errors));
assert.equal(findings.cases.map((item) => item.id).join(','), 'W01,W02,W03,W04,W05,W06,W07,W08');
const plan = parse('runtime-parity-plan.json');
assert.equal(plan.status, 'proposal-not-approved-not-implemented-not-executed');
assert.equal(plan.releaseAcceptance, false);
assert.equal(plan.arms.length, 5);
assert.equal(plan.bounds.maxPowerShellSmokeLaunches, 38);
assert.equal(plan.bounds.maxPowerShellLaunchesIncludingConditionalAnalogs, 76);
const analysis = parse('analysis.json');
for (const item of analysis.evidenceInventory) {
  const copied = read(item.path);
  const source = readFileSync(join(parentDirectory, item.path.slice('original/'.length)));
  assert.equal(copied.length, item.bytes);
  assert.equal(sha(copied), item.sha256);
  assert.equal(sha(source), item.sha256);
  assert(copied.equals(source));
}
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 });
const baseline = findings.releaseBaseline, nativeHead = findings.diagnosticHead;
const productPaths = ['src', 'tests', '.github/workflows/deploy-vps.yml', 'package.json', 'package-lock.json'];
assert.equal(git(['diff', baseline, nativeHead, '--', ...productPaths]), '');
assert.equal(git(['diff', '98c30de2852e6347b3336b774b7a04d850f6103b', nativeHead, '--',
  'docs/test-reports/windows-release-diagnosis-20261008/native-diagnostics.mjs',
  'docs/test-reports/windows-release-diagnosis-20261008/trace-preload.mjs']), '');
assert.equal(git(['diff', 'HEAD', '--', ...productPaths, 'progress.json', 'features.json', 'backlog.json',
  'docs/test-reports/windows-release-diagnosis-20261008',
  ':(exclude)docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1']), '');
const derivedBefore = sha(read('analysis.json'));
execFileSync(process.execPath, [join(here, 'analyze.mjs')], { cwd: repo, maxBuffer: 4096 });
assert.equal(sha(read('analysis.json')), derivedBefore);
for (const name of ['analyze.mjs', 'check-local.mjs']) {
  execFileSync(process.execPath, ['--check', join(here, name)], { cwd: repo, maxBuffer: 4096 });
}
const scriptHashes = Object.fromEntries(['analyze.mjs', 'check-local.mjs'].map((name) => [name, sha(read(name))]));
const result = { schemaVersion: 1, localAnalysisOnly: true, nativeRuntimeExecutedLocally: false,
  node: process.version, platform: process.platform, syntaxChecksPassed: 2,
  findingsSchemaValid: true, parityPlanUnexecutedAndBounded: true, eightUniqueCaseIds: true, evidenceFilesCompared: analysis.evidenceInventory.length,
  copiedEvidenceByteIdenticalToParentDownload: true, derivedAnalysisDeterministic: true,
  productAndOldTestDiffBaselineToNativeHeadEmpty: true, transportedDiagnosticScriptsUnchanged: true,
  originalReportAndProductAndStateWorkingTreeDiffEmpty: true, scriptHashes,
  releaseAcceptance: false, releaseReady: false };
writeFileSync(join(here, 'local-checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
