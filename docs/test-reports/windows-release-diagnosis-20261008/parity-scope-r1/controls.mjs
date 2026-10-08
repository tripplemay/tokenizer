import fs from 'node:fs';
import cp from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { EventEmitter, errorMonitor } from 'node:events';
import { join, resolve, basename, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { BOUNDS, ARM_KEYS, SOURCE_FREEZE, armEnvironment, admission, validProbe } from '../native-runtime-parity.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../..');
const cliPath = 'docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs';
const source = fs.readFileSync(join(repo, cliPath), 'utf8');
const exactSource = '5ab1c93894aebcfb2ffad50604e942a10c3655f7';
const scopeBase = '846e8e07614a97dcebd9d2cd2bdb678f971651fd';
const git = (args) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(git(['rev-parse', 'HEAD']), exactSource);
assert.equal(git(['show', exactSource + ':' + cliPath]), source.trim());
const results = [];
const control = async (id, expected, action) => {
  try {
    const observed = await action();
    results.push({ id, execution: 'completed', expected, ...observed });
  } catch (error) {
    results.push({ id, execution: 'failed', expected, errorClass: error.constructor.name,
      errorCode: error.code ?? null, assertionMessage: error.message });
  }
};
const countsSource = source.slice(source.indexOf('function counts('), source.indexOf('// Both forms retain'));
const guardSource = source.slice(source.indexOf('function installGuard()'), source.indexOf('\nfunction readRows('));
const rowsSource = source.slice(source.indexOf('function readRows('), source.indexOf('\nexport function validProbe('));
const healthSource = source.slice(source.indexOf('function healthStates('), source.indexOf('\nasync function runParent('));
const parentSource = source.slice(source.indexOf('async function runParent('), source.indexOf('\nasync function runProbe('));

function mockedGuard(mode) {
  const files = new Map([['/run/counter', ''], ['/run/case/log', '']]);
  const nativeError = Object.assign(new Error('mock native error'), { code: 'ENOENT' });
  const child = new EventEmitter();
  Object.assign(child, { pid: 102, exitCode: null, signalCode: null, killCalls: 0,
    kill() { this.killCalls++; } });
  const syncResult = { pid: 103, status: 0, signal: null };
  let timer, exitCode, syncCalls = 0;
  const processMock = new EventEmitter();
  Object.assign(processMock, { pid: 101,
    argv: ['node', 'worker', JSON.stringify({ timeoutMs: 7000 })],
    env: { TW_ROOT: '/run/case', TW_PARITY_RUN_ROOT: '/run', TW_PARITY_GUARD_LOG: '/run/case/log',
      TW_PARITY_GUARD_HEALTH: '/run/case/health', TW_PARITY_COUNTER: '/run/counter',
      TW_PARITY_CASE_DEADLINE: '41000', TW_PARITY_TOTAL_DEADLINE: '600000', TW_PARITY_KIND: 'smoke', TW_PARITY_TRACE: 'off' },
    exit(code) { exitCode = code; this.emit('exit'); } });
  const fsMock = {
    readFileSync(path) { if (mode === 'counter-logger-failure' && path === '/run/counter') throw nativeError; return files.get(path); },
    writeFileSync(path, value) { files.set(path, value); },
    statSync(path) { if (mode === 'logger-stat') throw nativeError; return { size: Buffer.byteLength(files.get(path) ?? '') }; },
    appendFileSync(path, value) {
      if (['logger-append', 'counter-logger-failure'].includes(mode) && path === '/run/case/log') throw nativeError;
      files.set(path, (files.get(path) ?? '') + value);
    }
  };
  const cpMock = {
    spawn() { if (mode === 'native-throw') throw nativeError; return child; },
    spawnSync() { syncCalls++; if (mode === 'sync-throw') throw nativeError; return syncResult; }
  };
  vm.runInNewContext(countsSource + '\n(' + guardSource + ')()', {
    fs: fsMock, cp: cpMock, process: processMock, BOUNDS, assert, join, basename, errorMonitor,
    owned: (root, path) => typeof path === 'string' && (root === path || path.startsWith(root + '/')),
    Date: { now: () => 1000 }, syncBuiltinESMExports() {}, setTimeout(callback) { timer = callback; return { unref() {} }; }
  });
  return { files, child, cpMock, processMock, nativeError, syncResult,
    expire: () => timer(), exitCode: () => exitCode, syncCalls: () => syncCalls };
}

await control('C01-exact-source-and-path-scope', 'Only approved new files and workflow command/label/metadata', () => {
  const changedPaths = git(['diff', '--name-only', scopeBase, exactSource]).split('\n');
  assert(changedPaths.every((path) => path === '.github/workflows/windows-release-diagnostics.yml' || path === cliPath ||
    path.startsWith('docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r1/')));
  const oldWorkflow = git(['show', scopeBase + ':.github/workflows/windows-release-diagnostics.yml']);
  const expectedWorkflow = oldWorkflow.replace('Run unchanged reviewed native diagnostic CLI', 'Run reviewed bounded runtime parity diagnostic CLI')
    .replace("$script = 'docs/test-reports/windows-release-diagnosis-20261008/native-diagnostics.mjs'", "$script = '" + cliPath + "'")
    .replaceAll('            diagnostic_only = $true\n', "            diagnostic_only = $true\n            diagnostic_cli = 'native-runtime-parity.mjs'\n            source_freeze_head = '" + SOURCE_FREEZE + "'\n");
  assert.equal(git(['show', exactSource + ':.github/workflows/windows-release-diagnostics.yml']), expectedWorkflow);
  return { passed: true, violation: false, changedPaths };
});
await control('C02-frozen-trees-and-original-hashes', 'Product/tests/state/old reports and 32 originals unchanged', () => {
  const frozen = ['src', 'tests', 'package.json', 'package-lock.json', 'progress.json', 'features.json', 'backlog.json',
    '.github/workflows/deploy-vps.yml', 'docs/test-reports/windows-release-diagnosis-20261008/native-diagnostics.mjs',
    'docs/test-reports/windows-release-diagnosis-20261008/trace-preload.mjs', 'docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1'];
  const objects = frozen.map((path) => ({ path, base: git(['rev-parse', scopeBase + ':' + path]), current: git(['rev-parse', exactSource + ':' + path]) }));
  assert(objects.every((entry) => entry.base === entry.current));
  const originals = JSON.parse(fs.readFileSync(join(repo, 'docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1/analysis.json'))).evidenceInventory;
  for (const entry of originals) assert.equal(digest(fs.readFileSync(join(repo, 'docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1', entry.path))), entry.sha256);
  return { passed: true, violation: false, objects, originalHashesVerified: originals.length };
});
await control('C03-env-and-admission', 'One environment key per arm; fixed 43-second reserve and launch caps', () => {
  const arms = Object.keys(ARM_KEYS).map((arm) => {
    const env = armEnvironment({ SystemRoot: 'C:\\Windows', HOME: '/synthetic/home' }, arm, '/synthetic');
    assert.deepEqual(env.changedKeys, ARM_KEYS[arm] ? [ARM_KEYS[arm]] : []);
    return { arm, changedKeys: env.changedKeys };
  });
  assert.equal(admission({ now: 0, deadline: 42999, usedTotal: 0, usedSmoke: 0, requiredPs: 3, smoke: true }), 'global-cleanup-output-allowance-insufficient');
  assert.equal(admission({ now: 0, deadline: 43000, usedTotal: 73, usedSmoke: 35, requiredPs: 3, smoke: true }), null);
  assert.equal(admission({ now: 0, deadline: 600000, usedTotal: 63, usedSmoke: 30, requiredPs: 14, smoke: false }), 'total-powershell-budget-insufficient');
  return { passed: true, violation: false, arms, bounds: BOUNDS };
});
await control('C04-logger-and-native-semantics', 'Logger failure preserves return/exception/error event and adds no stream observer', () => {
  const modes = [];
  for (const mode of ['normal', 'logger-stat', 'logger-append', 'native-throw', 'sync-throw']) {
    const mock = mockedGuard(mode);
    if (mode === 'native-throw') assert.throws(() => mock.cpMock.spawn('node.exe', []), (error) => error === mock.nativeError);
    else if (mode === 'sync-throw') assert.throws(() => mock.cpMock.spawnSync('node.exe', []), (error) => error === mock.nativeError);
    else {
      assert.equal(mock.cpMock.spawn('powershell.exe', []), mock.child);
      assert.equal(mock.cpMock.spawnSync('node.exe', []), mock.syncResult);
      assert.throws(() => mock.child.emit('error', mock.nativeError), (error) => error === mock.nativeError);
      assert.equal(mock.child.listenerCount('error'), 0);
      assert.equal(mock.child.listenerCount('data'), 0);
    }
    modes.push(mode);
  }
  assert(!guardSource.includes(".on('data'"));
  return { passed: true, violation: false, modes };
});
await control('C05-owned-handle-cleanup', 'Expired active owned handle only; closed handle never signalled', () => {
  const active = mockedGuard('normal'); active.cpMock.spawn('node.exe', []); active.expire();
  assert.equal(active.child.killCalls, 1); assert.equal(active.syncCalls(), 1); assert.equal(active.exitCode(), 92);
  const closed = mockedGuard('normal'); closed.cpMock.spawn('node.exe', []); closed.child.exitCode = 0; closed.expire();
  assert.equal(closed.child.killCalls, 0); assert.equal(closed.syncCalls(), 0);
  return { passed: true, violation: false, activeOwnedHandleKillCalls: 1, closedHandleKillCalls: 0 };
});

async function mockedParent(mode) {
  const files = new Map();
  const put = (path, value) => files.set(path, Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  const fsMock = { mkdirSync() {}, realpathSync(path) { return path; }, mkdtempSync() { return 'C:\\owned-run'; },
    writeFileSync: put, existsSync(path) { return files.has(path); },
    readFileSync(path, encoding) { const value = files.get(path); if (!value) throw Object.assign(new Error('mock absent'), { code: 'ENOENT' }); return encoding ? value.toString(encoding) : value; },
    rmSync() {} };
  let childNumber = 200;
  const cpMock = { spawn(_command, _args, { env }) {
    const child = new EventEmitter(); Object.assign(child, { pid: ++childNumber, exitCode: mode === 'expiry' ? 92 : 0,
      signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(), unref() {}, kill() {} });
    child.stdout.destroy = child.stderr.destroy = () => {};
    const guardRows = [{ event: 'guard-preload', pid: child.pid }];
    if (mode === 'expiry') guardRows.push({ event: 'owned-lifetime-expired', pid: child.pid });
    if (mode === 'injected-jsonl') guardRows.push({ event: 'child-error', pid: child.pid, rawStderr: 'RAW-STDERR-CANARY', unknownSecretKey: 'PRIVATE' });
    put(env.TW_PARITY_GUARD_LOG, guardRows.map(JSON.stringify).join('\n') + '\n');
    put(win32.join(env.TW_PARITY_GUARD_HEALTH, child.pid + '.json'), JSON.stringify({ pid: child.pid, state: 'complete' }));
    if (env.TW_PARITY_TRACE === 'on') {
      put(env.TW_TRACE, JSON.stringify({ event: 'preload', pid: child.pid, ...(mode === 'injected-jsonl' ? { arbitraryContent: 'TW_RAW_CONTENT_CANARY' } : {}) }) + '\n');
      put(win32.join(env.TW_TRACE_HEALTH, child.pid + '.json'), JSON.stringify({ pid: child.pid, state: 'complete' }));
    }
    queueMicrotask(() => {
      if (mode !== 'expiry') child.stdout.emit('data', Buffer.from(JSON.stringify({ case: env.TW_PARITY_CASE, arm: env.TW_PARITY_ARM,
        oldTracePreload: env.TW_PARITY_TRACE, commonBudgetGuardOn: true, operationBudgetMs: 10000,
        p2Succeeded: env.TW_PARITY_CASE === 'smoke', observations: [], releaseAcceptance: false })));
      child.emit('close', child.exitCode, null);
    });
    return child;
  }, spawnSync() { throw new Error('native cleanup unexpectedly attempted'); } };
  const processMock = { env: { SystemRoot: 'C:\\Windows', HOME: 'unrelated-home', USERPROFILE: 'unrelated-profile',
    APPDATA: 'unrelated-appdata', LOCALAPPDATA: 'unrelated-localappdata', PSModulePath: 'unrelated-personal-module', TOKEN: 'unrelated-token' },
    execPath: 'C:\\node.exe', version: process.version, versions: process.versions, platform: 'win32', kill() { throw Object.assign(new Error(), { code: 'ESRCH' }); } };
  const context = { fs: fsMock, cp: cpMock, process: processMock, BOUNDS, SOURCE_FREEZE, ARM_KEYS, assert, Buffer,
    join: win32.join, basename: win32.basename, here: 'C:\\repo\\docs', repo: 'C:\\repo', self: 'C:\\repo\\docs\\native-runtime-parity.mjs',
    guardUrl: pathToFileURL('/mock-guard'), traceUrl: 'file:///mock-trace', rawCanary: 'TW_RAW_CONTENT_CANARY',
    tmpdir: () => 'C:\\tmp', armEnvironment, admission, validProbe, errorMonitor,
    Date: { now: () => 1000 }, setTimeout() { return 1; }, clearTimeout() {}, console: { log() {} } };
  const fn = vm.runInNewContext(countsSource + '\n' + rowsSource + '\n' + healthSource + '\n(' + parentSource + ')', context);
  await fn();
  return { files, processMock };
}

await control('C06-expiry-not-reached-classification', 'Owned lifetime guard abort explicitly diagnostic-not-reached', async () => {
  const mock = await mockedParent('expiry');
  const record = JSON.parse(mock.files.get('C:\\repo\\docs\\native-output-parity-1000\\smoke-off-E0.json'));
  const cleanup = JSON.parse(mock.files.get('C:\\repo\\docs\\native-output-parity-1000\\smoke-off-E0.cleanup.json'));
  const passed = record.classification === 'diagnostic-budget-not-reached';
  return { passed, violation: !passed, observed: { reached: record.reached, status: record.status, reported: record.reported,
    classificationPresent: Object.hasOwn(record, 'classification'), guardAborts: record.guardAborts,
    diagnosticCompleted: record.diagnosticCompleted, cleanupUnknown: cleanup.cleanupUnknown, cleanupUnknownBasis: cleanup.cleanupUnknownBasis } };
});
await control('C07-artifact-jsonl-allowlist-boundary', 'Unknown keys/raw stderr/content/credential fixture rejected before artifact publication', async () => {
  const mock = await mockedParent('injected-jsonl');
  const artifactBytes = [...mock.files].filter(([path]) => /native-output-parity.*\.(?:guard|trace)\.jsonl$/.test(path)).map(([, bytes]) => bytes.toString());
  const unknownKeysPublished = artifactBytes.some((value) => /rawStderr|unknownSecretKey|arbitraryContent/.test(value));
  const rawFixturePublished = artifactBytes.some((value) => /RAW-STDERR-CANARY|PRIVATE|TW_RAW_CONTENT_CANARY/.test(value));
  const summary = JSON.parse(mock.files.get('C:\\repo\\docs\\native-output-parity-1000\\parity-summary.json'));
  return { passed: !unknownKeysPublished && !rawFixturePublished, violation: unknownKeysPublished || rawFixturePublished,
    unknownKeysPublished, rawFixturePublished, diagnosticCompletedDespiteInjectedRows: summary.diagnosticCompleted,
    actualHostSecretAccess: false, allFilesVirtual: true };
});
await control('C08-guard-error-code-sanitization', 'Native error metadata cannot carry arbitrary raw code strings into artifacts', () => {
  const mock = mockedGuard('normal'); mock.cpMock.spawn('node.exe', []);
  const error = Object.assign(new Error('mock error'), { code: 'RAW-STDERR-CANARY' });
  assert.throws(() => mock.child.emit('error', error), (observed) => observed === error);
  const rawFixtureLogged = mock.files.get('/run/case/log').includes('RAW-STDERR-CANARY');
  return { passed: !rawFixtureLogged, violation: rawFixtureLogged, rawFixtureLogged, nativeErrorPreserved: true, actualHostSecretAccess: false };
});
await control('C09-protocol-completeness', 'P2 admission requires stage evidence; empty smoke output cannot assert complete P2', () => {
  const accepted = validProbe({ case: 'smoke', arm: 'E0', oldTracePreload: 'off', commonBudgetGuardOn: true,
    operationBudgetMs: 10000, p2Succeeded: true, observations: [], releaseAcceptance: false }, 'smoke', 'E0', 'off');
  return { passed: !accepted, violation: false, riskObserved: accepted, emptyObservationsAcceptedForP2: accepted,
    scope: 'protocol defense gap; actual runProbe missing observations not demonstrated' };
});
await control('C10-workflow-and-syntax', 'Static syntax and dedicated workflow actionlint', () => {
  for (const path of [cliPath, 'docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r1/checks.mjs']) cp.execFileSync(process.execPath, ['--check', join(repo, path)]);
  cp.execFileSync('/opt/homebrew/bin/actionlint', ['.github/workflows/windows-release-diagnostics.yml'], { cwd: repo });
  return { passed: true, violation: false, syntaxChecks: 2, actionlintExitCode: 0 };
});
const output = { schemaVersion: 1, role: 'supporting-independent-scope-critic-controls', exactSource, scopeBase,
  scriptSha256: digest(source), node: process.version, platform: process.platform,
  nativeWindowsExecuted: false, productRuntimeExecuted: false, mockedParentAndGuardOnly: true,
  controls: results, violation: results.some((result) => result.violation === true),
  controlExecutionFailure: results.some((result) => result.execution === 'failed'), releaseAcceptance: false, releaseReady: false };
fs.writeFileSync(join(here, 'controls.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ controls: results.length, violation: output.violation, controlExecutionFailure: output.controlExecutionFailure,
  failedExpectations: results.filter((result) => result.passed === false).map(({ id, violation }) => ({ id, violation })),
  nativeWindowsExecuted: false, productRuntimeExecuted: false, releaseAcceptance: false }));
process.exitCode = output.violation || output.controlExecutionFailure ? 1 : 0;
