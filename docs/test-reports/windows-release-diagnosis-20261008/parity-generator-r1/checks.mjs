import fs from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { EventEmitter, errorMonitor } from 'node:events';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { BOUNDS, ARM_KEYS, SOURCE_FREEZE, NATIVE_SCRIPT, armEnvironment, admission, validProbe } from '../native-runtime-parity.mjs';

assert(process.version.startsWith('v22.'), 'Node22 checks only');
const here = fileURLToPath(new URL('.', import.meta.url));
const docs = dirname(here), repo = resolve(here, '../../../..');
const require = createRequire(import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => fs.readFileSync(join(repo, path));
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const scopeBase = '846e8e07614a97dcebd9d2cd2bdb678f971651fd';
const script = fs.readFileSync(join(docs, 'native-runtime-parity.mjs'), 'utf8');
const product = read('src/cli/replay.ts').toString();
assert.equal(NATIVE_SCRIPT, JSON.parse(product.match(/const script = ("[^\n]+?");/)[1]));
assert.deepEqual(BOUNDS, { totalMs: 600000, caseMs: 40000, cleanupMs: 3000, operationMs: 10000,
  smokeChildMs: 7000, smokePs: 38, totalPs: 76, outputBytes: 65536, traceBytes: 524288, attributeBytes: 16384 });
const envResults = [];
for (const arm of Object.keys(ARM_KEYS)) {
  const base = { SystemRoot: 'C:\\Windows', PATH: 'synthetic-public-system-path', HOME: '/owned/home' };
  const copy = { ...base };
  const result = armEnvironment(base, arm, '/owned');
  assert.deepEqual(base, copy);
  assert.deepEqual(result.changedKeys, ARM_KEYS[arm] ? [ARM_KEYS[arm]] : []);
  assert(!Object.hasOwn(result.env, 'TOKEN') && !Object.hasOwn(result.env, 'GITHUB_TOKEN'));
  envResults.push({ arm, changedKeys: result.changedKeys, baseUnchanged: true });
}
assert.throws(() => armEnvironment({ SystemRoot: '\\\\network\\share' }, 'E1', '/owned'));
assert.throws(() => armEnvironment({ SystemRoot: 'C:\\Windows' }, 'E5', '/owned'));
const admissionResults = [];
for (const [name, inputs, expected] of [
  ['exact-case-reserve', { now: 1000, deadline: 44000, usedTotal: 73, usedSmoke: 35, requiredPs: 3, smoke: true }, null],
  ['one-ms-short', { now: 1000, deadline: 43999, usedTotal: 0, usedSmoke: 0, requiredPs: 3, smoke: true }, 'global-cleanup-output-allowance-insufficient'],
  ['total-cap', { now: 0, deadline: 600000, usedTotal: 74, usedSmoke: 20, requiredPs: 3, smoke: true }, 'total-powershell-budget-insufficient'],
  ['smoke-cap', { now: 0, deadline: 600000, usedTotal: 35, usedSmoke: 36, requiredPs: 3, smoke: true }, 'smoke-powershell-budget-insufficient'],
  ['analog-no-budget', { now: 0, deadline: 600000, usedTotal: 63, usedSmoke: 30, requiredPs: 14, smoke: false }, 'total-powershell-budget-insufficient']
]) { assert.equal(admission(inputs), expected); admissionResults.push({ name, expected }); }
const safeProbe = { case: 'smoke', arm: 'E0', oldTracePreload: 'off', commonBudgetGuardOn: true,
  operationBudgetMs: 10000, p2Succeeded: true, observations: [{ stage: 'P0', reached: true, ok: true,
    elapsedMs: 1, value: { fixedMarkerMatched: true, status: 0, signal: null, stdoutBytes: 20, stderrBytes: 0 } }], releaseAcceptance: false };
assert(validProbe(safeProbe, 'smoke', 'E0', 'off'));
for (const bad of [{ ...safeProbe, environment: { TOKEN: 'never-print' } },
  { ...safeProbe, arm: 'E5' }, { ...safeProbe, observations: [{ stage: 'P0', value: { stderr: 'never-print' } }] },
  { ...safeProbe, observations: [{ stage: 'P0', reason: 'C:\\real-profile' }] }]) assert(!validProbe(bad, 'smoke', 'E0', 'off'));

// Pure VM mocks: no native process, filesystem, timer or product execution.
const guardSource = script.slice(script.indexOf('function installGuard()'), script.indexOf('\nfunction readRows('));
const countsSource = script.slice(script.indexOf('function counts('), script.indexOf('// Both forms retain'));
assert(!guardSource.includes(".on('error'"));
assert(!guardSource.includes(".on('data'"));
const mockResults = [];
function guardMock(mode) {
  const files = new Map([['/owned/run/counter', mode === 'cap' ? Array(76).fill('{"event":"powershell-admission","kind":"downstream"}').join('\n') + '\n' : ''], ['/owned/run/case/log', '']]);
  const nativeError = Object.assign(new Error('native-error-identity'), { code: 'ENOENT' });
  const child = new EventEmitter(); Object.assign(child, { pid: 11, exitCode: null, signalCode: null, killed: false,
    kill() { this.killed = true; } });
  const originalSyncResult = { pid: 12, status: 0, signal: null };
  let spawnCalls = 0, syncCalls = 0, timer, exitCode;
  const proc = new EventEmitter(); Object.assign(proc, { pid: 10,
    argv: ['node', 'bounded-subprocess-worker.mjs', JSON.stringify({ timeoutMs: 100 })],
    env: { TW_ROOT: '/owned/run/case', TW_PARITY_RUN_ROOT: '/owned/run', TW_PARITY_GUARD_LOG: '/owned/run/case/log',
      TW_PARITY_GUARD_HEALTH: '/owned/run/case/health', TW_PARITY_COUNTER: '/owned/run/counter',
      TW_PARITY_CASE_DEADLINE: '100000', TW_PARITY_TOTAL_DEADLINE: '100000', TW_PARITY_KIND: 'smoke', TW_PARITY_TRACE: 'off' },
    exit(code) { exitCode = code; proc.emit('exit'); } });
  const fakeFs = {
    readFileSync(path) { if (!files.has(path)) throw nativeError; return files.get(path); },
    writeFileSync(path, value) { files.set(path, value); },
    statSync(path) { if (mode === 'logger-stat') throw nativeError; return { size: files.get(path)?.length ?? 0 }; },
    appendFileSync(path, value) { if ((mode === 'logger-append' && path.endsWith('/log')) || (mode === 'counter-fail' && path.endsWith('/counter'))) throw nativeError;
      files.set(path, (files.get(path) ?? '') + value); }
  };
  const fakeCp = { spawn() { spawnCalls++; if (mode === 'native-throw') throw nativeError; return child; },
    spawnSync() { syncCalls++; if (mode === 'sync-throw') throw nativeError; return originalSyncResult; } };
  vm.runInNewContext(countsSource + '\n(' + guardSource + ')()', { fs: fakeFs, cp: fakeCp, process: proc, BOUNDS,
    join, basename, owned: (root, path) => typeof path === 'string' && (path === root || path.startsWith(root + '/')),
    Date: { now: () => 1000 }, errorMonitor, assert, syncBuiltinESMExports() {},
    setTimeout(action) { timer = action; return { unref() {} }; } });
  if (mode === 'native-throw') assert.throws(() => fakeCp.spawn('node.exe', []), (error) => error === nativeError);
  else if (mode === 'sync-throw') assert.throws(() => fakeCp.spawnSync('node.exe', []), (error) => error === nativeError);
  else if (['counter-fail', 'cap'].includes(mode)) {
    assert.throws(() => fakeCp.spawn('powershell.exe', []), (error) => error.code === 'TW_PARITY_BUDGET');
    assert.equal(spawnCalls, 0);
    assert(files.get('/owned/run/case/log').includes('diagnostic-budget-abort'));
  } else {
    assert.equal(fakeCp.spawn('powershell.exe', []), child);
    assert.equal(fakeCp.spawnSync('node.exe', []), originalSyncResult);
    assert.throws(() => child.emit('error', nativeError), (error) => error === nativeError);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.listenerCount('data'), 0);
    if (mode === 'expired-already-closed') child.exitCode = 0;
    if (mode.startsWith('expired')) {
      const before = syncCalls; timer(); assert.equal(exitCode, 92);
      assert.equal(child.killed, mode === 'expired-active-owned-handle');
      assert.equal(syncCalls - before, mode === 'expired-active-owned-handle' ? 1 : 0);
    }
  }
  proc.emit('exit');
  const state = JSON.parse(files.get('/owned/run/case/health/10.json'));
  if (mode.startsWith('logger-') || mode === 'counter-fail') assert.equal(state.state, 'failed');
  mockResults.push({ mode, passed: true, noNativeExecution: true, healthState: state.state });
}
for (const mode of ['normal', 'native-throw', 'sync-throw', 'logger-stat', 'logger-append', 'counter-fail', 'cap', 'expired-active-owned-handle', 'expired-already-closed']) guardMock(mode);

const oldWorkflow = git(['show', SOURCE_FREEZE + ':.github/workflows/windows-release-diagnostics.yml']);
const expectedWorkflow = oldWorkflow.replace('Run unchanged reviewed native diagnostic CLI', 'Run reviewed bounded runtime parity diagnostic CLI')
  .replace("$script = 'docs/test-reports/windows-release-diagnosis-20261008/native-diagnostics.mjs'", "$script = 'docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs'")
  .replaceAll('            diagnostic_only = $true\n', "            diagnostic_only = $true\n            diagnostic_cli = 'native-runtime-parity.mjs'\n            source_freeze_head = '" + SOURCE_FREEZE + "'\n");
assert.equal(read('.github/workflows/windows-release-diagnostics.yml').toString(), expectedWorkflow);
execFileSync('/opt/homebrew/bin/actionlint', ['.github/workflows/windows-release-diagnostics.yml'], { cwd: repo, maxBuffer: 4096 });
const protectedPaths = ['src', 'tests', 'package.json', 'package-lock.json', '.github/workflows/deploy-vps.yml', 'progress.json', 'features.json', 'backlog.json'];
assert.equal(git(['diff', SOURCE_FREEZE, '--', ...protectedPaths]), '');
assert.equal(git(['diff', scopeBase, '--', 'docs/test-reports/windows-release-diagnosis-20261008',
  ':(exclude)docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs',
  ':(exclude)docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r1']), '');
const originalInventory = JSON.parse(read('docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1/analysis.json')).evidenceInventory;
for (const entry of originalInventory) assert.equal(sha(fs.readFileSync(join(docs, 'native-findings-r1', entry.path))), entry.sha256);
const frozenArtifacts = ['src', 'tests', 'package.json', 'package-lock.json', 'progress.json', 'features.json',
  '.github/workflows/deploy-vps.yml', 'docs/test-reports/windows-release-diagnosis-20261008/native-diagnostics.mjs',
  'docs/test-reports/windows-release-diagnosis-20261008/trace-preload.mjs', 'docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1/original'];
const inventory = frozenArtifacts.map((path) => ({ path, frozenGitObject: git(['rev-parse', SOURCE_FREEZE + ':' + path]).trim(),
  currentCommittedGitObject: git(['rev-parse', 'HEAD:' + path]).trim() }));
assert(inventory.every((entry) => entry.frozenGitObject === entry.currentCommittedGitObject));
for (const name of ['native-runtime-parity.mjs', 'parity-generator-r1/checks.mjs']) execFileSync(process.execPath, ['--check', join(docs, name)], { maxBuffer: 4096 });
const checks = { schemaVersion: 1, role: 'supporting-generator-static-checks', sourceFreezeHead: SOURCE_FREEZE, scopeBaseHead: scopeBase,
  node: process.version, platform: process.platform, nativeWindowsExecuted: false, productRuntimeExecuted: false,
  syntaxChecks: 2, envResults, admissionResults, guardMockResults: mockResults,
  protocolAllowlistControlsPassed: true, nativeAttributeScriptExact: true,
  workflowOnlyApprovedCommandLabelMetadataChanged: true, frozenProductTestsStateAndReportsUnchanged: true,
  workflowActionlintPassed: true,
  originalEvidenceHashesVerified: originalInventory.length, optionalCombinedArmImplemented: false,
  proofInventory: inventory, newFileHashes: Object.fromEntries(['native-runtime-parity.mjs', 'parity-generator-r1/checks.mjs']
    .map((name) => [name, sha(fs.readFileSync(join(docs, name)))])), releaseAcceptance: false, releaseReady: false };
const Ajv = require('/Volumes/ORICO/project/tokenizer/node_modules/ajv');
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(fs.readFileSync(join(here, 'checks.schema.json'))));
assert(validate(checks), JSON.stringify(validate.errors));
fs.writeFileSync(join(here, 'local-checks.json'), JSON.stringify(checks, null, 2) + '\n');
const artifactPaths = ['.github/workflows/windows-release-diagnostics.yml',
  'docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs',
  ...['checks.mjs', 'checks.schema.json', 'local-checks.json', 'README.md'].map((name) =>
    'docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r1/' + name)];
fs.writeFileSync(join(here, 'handoff.json'), JSON.stringify({ schemaVersion: 1, sourceFreezeHead: SOURCE_FREEZE,
  scopeBaseHead: scopeBase, postCommitIndependentScopeReviewRequired: true, nativeWindowsExecuted: false,
  artifacts: artifactPaths.map((path) => ({ path, sha256: sha(read(path)), bytes: read(path).length })),
  proofInventory: inventory, originalEvidenceHashesVerified: 32, releaseAcceptance: false, releaseReady: false }, null, 2) + '\n');
console.log(JSON.stringify({ syntaxChecks: checks.syntaxChecks, mockControls: mockResults.length,
  originalEvidenceHashesVerified: checks.originalEvidenceHashesVerified, nativeWindowsExecuted: false, releaseAcceptance: false }));
