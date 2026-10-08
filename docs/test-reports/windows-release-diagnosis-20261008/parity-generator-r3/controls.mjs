import fs from 'node:fs';
import cp from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { EventEmitter, errorMonitor } from 'node:events';
import { resolve, join, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../..');
const cliPath = 'docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs';
const r1Source = '5ab1c93894aebcfb2ffad50604e942a10c3655f7';
const scopeBase = '846e8e07614a97dcebd9d2cd2bdb678f971651fd';
const exactSource = process.argv[2];
const outputName = process.argv[3];
assert(exactSource === 'DRAFT' || /^[a-f0-9]{40}$/.test(exactSource ?? ''));
assert(/^controls-(?:draft|frozen)-[a-z0-9-]+\.json$/.test(outputName ?? ''));
const outputPath = join(here, outputName);
assert(!fs.existsSync(outputPath), 'Evidence outputs are append-only; choose a new filename');
const git = (...args) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sourceBytes = exactSource === 'DRAFT' ? fs.readFileSync(join(repo, cliPath)) :
  cp.execFileSync('git', ['show', exactSource + ':' + cliPath], { cwd: repo });
const source = sourceBytes.toString('utf8');
const sourceHash = hash(sourceBytes);
const r1Hashes = {
  'verdict.json': '106ff610950022b23702207dbcac051a4d9499e6c772f6ba1c30eb05679706ce',
  'controls.mjs': 'b562d74205e75ee0587c8349b44dc35a38af96527a25b529c4c46a486e6983d2',
  'controls.json': '5289c79db1eb913969d3d96f20169f34b49ea4475d1deb4c4e25003189eb4f92'
};

const executableSource = source.slice(0, source.indexOf('\nasync function runProbe('))
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '')
  .replace(/const here = .*;/, "const here = 'C:\\\\repo\\\\docs';")
  .replace(/const repo = .*;/, "const repo = 'C:\\\\repo';")
  .replace(/const self = .*;/, "const self = 'C:\\\\repo\\\\docs\\\\native-runtime-parity.mjs';");
function api(overrides = {}) {
  const context = { fs: {}, cp: {}, process: {}, Buffer, assert, errorMonitor, createHash,
    join: win32.join, resolve: win32.resolve, relative: win32.relative, isAbsolute: win32.isAbsolute,
    basename: win32.basename, dirname: win32.dirname, parse: win32.parse, win32,
    fileURLToPath, pathToFileURL, URL, tmpdir: () => 'C:\\tmp',
    Date: { now: () => 1000 }, setTimeout() { return { unref() {} }; }, clearTimeout() {},
    syncBuiltinESMExports() {}, console: { log() {} }, ...overrides };
  return vm.runInNewContext(executableSource + '\n({ BOUNDS, ARM_KEYS, SOURCE_FREEZE, armEnvironment, admission,\n' +
    'rootMetadata, safeCode, errorCode, evidenceEvent, publicJsonl, validProbe, probeCoverage, counts, installGuard, readRows, healthStates, runParent })', context);
}
const pure = api();
const plain = (value) => JSON.parse(JSON.stringify(value));
const results = [];
async function control(id, action) {
  try { results.push({ id, execution: 'completed', passed: true, violation: false, ...await action() }); }
  catch (error) { results.push({ id, execution: 'failed', passed: false, violation: true,
    errorClass: error.constructor.name, assertionCode: 'LOCAL_CONTROL_EXPECTATION_FAILED' }); }
}
const baseGuard = (pid = 201, sequence = 0) => ({ pid, sequence, at: 1000, event: 'guard-preload',
  commonBudgetGuardOn: true, oldTracePreloadOn: false });
const baseTrace = (pid = 201, sequence = 0) => ({ pid, sequence, at: 1000, monotonicMs: 1,
  event: 'preload', node: 'v22.22.0', uv: '1.51.0' });
const measuredOK = (stage, value = {}) => ({ stage, reached: true, elapsedMs: 1, ok: true, value });
const measuredFail = (stage) => ({ stage, reached: true, elapsedMs: 1, ok: false,
  classification: 'observed-native-or-product-refusal', errorClass: 'Error', code: 'ENOENT', refusalKind: 'other-refusal' });
function probe(kind = 'smoke', arm = 'E0', trace = 'off') {
  let observations;
  if (kind === 'smoke') observations = ['P0', 'P1', 'P2'].map((stage) => measuredOK(stage,
    { status: 0, signal: null, fixedMarkerMatched: true, stdoutBytes: 10, stderrBytes: 0 }));
  else if (kind === 'parent') observations = ['afterPathStat', 'afterRead'].flatMap((stage) =>
    [measuredFail(stage), { stage: stage + '-hook', hookReached: true, hookStep: 'complete', hookCode: null }]);
  else if (kind === 'healthy') observations = [measuredOK('preview', { wouldAdmit: 1, hasDigest: true }),
    { stage: 'preview-read-only', unchanged: true }, measuredOK('execute', { admitted: 1, backlog: 0 }),
    { stage: 'queue', executeEntered: true, containsCanary: false, retained: true,
      warmSingleProductProcessNotOriginalColdProbeParity: true }];
  else observations = [measuredOK('preview', { wouldAdmit: 1, hasDigest: true }),
    ...(kind === 'binding' ? ['bad-digest', 'privacy-scope'] : ['projectRoots']).map(measuredFail),
    ...['privacy-mode', 'source-content'].map(measuredFail),
    { stage: 'merge-count', mergeCalls: 0, executeEntered: true, zeroDoesNotProveUnreachedNegative: false }];
  return { case: kind, arm, oldTracePreload: trace, commonBudgetGuardOn: true, operationBudgetMs: 10000,
    p2Succeeded: kind === 'smoke', observations, releaseAcceptance: false };
}

function mockGuard(mode = 'normal') {
  const files = new Map([['C:\\run\\counter', ''], ['C:\\run\\case\\log', '']]);
  const nativeError = Object.assign(new Error('synthetic native error'), { code: 'ENOENT' });
  const child = new EventEmitter();
  Object.assign(child, { pid: 102, exitCode: null, signalCode: null, killCalls: 0,
    kill() { this.killCalls++; return true; } });
  const syncResult = { pid: 103, status: 0, signal: null };
  let timer, exitCode, nativeSpawnCalls = 0, nativeSyncCalls = 0;
  const processMock = new EventEmitter();
  Object.assign(processMock, { pid: 101, argv: ['node', 'worker', '{"timeoutMs":7000}'], env: {
    TW_ROOT: 'C:\\run\\case', TW_PARITY_RUN_ROOT: 'C:\\run', TW_PARITY_GUARD_LOG: 'C:\\run\\case\\log',
    TW_PARITY_GUARD_HEALTH: 'C:\\run\\case\\health', TW_PARITY_COUNTER: 'C:\\run\\counter',
    TW_PARITY_CASE_DEADLINE: '41000', TW_PARITY_TOTAL_DEADLINE: '600000', TW_PARITY_KIND: 'smoke', TW_PARITY_TRACE: 'off'
  }, exit(code) { exitCode = code; this.emit('exit'); } });
  const fsMock = {
    readFileSync(path) { if (mode === 'counter-failure' && path.endsWith('counter')) throw nativeError; return files.get(path); },
    writeFileSync(path, value) { if (mode === 'health-failure') throw nativeError; files.set(path, value); },
    statSync(path) { if (mode === 'logger-stat') throw nativeError; return { size: Buffer.byteLength(files.get(path) ?? '') }; },
    appendFileSync(path, value) { if (['logger-append', 'counter-failure'].includes(mode) && path.endsWith('log')) throw nativeError;
      files.set(path, (files.get(path) ?? '') + value); }
  };
  const cpMock = {
    spawn() { nativeSpawnCalls++; if (mode === 'native-throw') throw nativeError; return child; },
    spawnSync(command) { nativeSyncCalls++; if (mode === 'sync-throw') throw nativeError;
      return command === 'taskkill.exe' ? { status: 128, signal: null } : syncResult; }
  };
  const guarded = api({ fs: fsMock, cp: cpMock, process: processMock,
    setTimeout(callback) { timer = callback; return { unref() {} }; } });
  guarded.installGuard();
  return { files, child, cpMock, processMock, nativeError, syncResult, guarded, expire: () => timer(),
    exitCode: () => exitCode, spawnCalls: () => nativeSpawnCalls, syncCalls: () => nativeSyncCalls };
}

async function mockParent(mode = 'normal', options = {}) {
  const files = new Map(), launches = [], removals = [], signals = [], timers = [];
  const put = (path, value) => files.set(path, Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  const fsMock = { mkdirSync() {}, realpathSync(path) { return path; }, mkdtempSync() { return 'C:\\owned-run'; },
    statSync(path) { return { size: files.get(path)?.length ?? 0 }; },
    writeFileSync: put, existsSync(path) { return files.has(path); },
    readFileSync(path, encoding) { const value = files.get(path); if (!value) throw Object.assign(new Error('synthetic absent'), { code: 'ENOENT' });
      return encoding ? value.toString(encoding) : value; },
    rmSync(path) { removals.push(path); } };
  let childNumber = 200;
  const cpMock = { spawn(_command, _args, { env }) {
    launches.push({ id: env.TW_ROOT.split('\\').at(-1), env: { ...env } });
    const child = new EventEmitter(); Object.assign(child, { pid: options.pid ?? ++childNumber,
      exitCode: options.status ?? (mode === 'expiry' ? 92 : 0), signalCode: options.signal ?? null,
      stdout: new EventEmitter(), stderr: new EventEmitter(), unref() {}, kill() { signals.push(child.pid); } });
    child.stdout.destroy = child.stderr.destroy = () => {};
    const trace = env.TW_PARITY_TRACE, kind = env.TW_PARITY_CASE, arm = env.TW_PARITY_ARM;
    let guardRows = [{ ...baseGuard(child.pid), oldTracePreloadOn: trace === 'on' }];
    if (mode === 'expiry') guardRows.push({ pid: child.pid, sequence: 1, at: 1000, event: 'owned-lifetime-expired' });
    if (mode === 'budget') guardRows.push({ pid: child.pid, sequence: 1, at: 1000, event: 'diagnostic-budget-abort', reason: 'total-powershell-budget-insufficient' });
    if (mode === 'injected-jsonl') guardRows.push({ pid: child.pid, sequence: 1, at: 1000, event: 'child-error',
      rawStderr: 'RAW-STDERR-CANARY', unknownSecretKey: 'PRIVATE' });
    if (mode === 'unsafe-guard-value') guardRows.push({ pid: child.pid, sequence: 1, at: 1000, event: 'child-error',
      executable: 'node.exe', childPid: child.pid, code: 'RAW-STDERR-CANARY' });
    put(env.TW_PARITY_GUARD_LOG, guardRows.map(JSON.stringify).join('\n') + '\n');
    put(win32.join(env.TW_PARITY_GUARD_HEALTH, child.pid + '.json'), JSON.stringify({ pid: child.pid,
      state: mode === 'logger-health' ? 'failed' : 'complete', ...(mode === 'logger-health' ? { reasonCode: 'GUARD_COUNTER_IO' } : {}) }));
    if (trace === 'on') {
      let row = baseTrace(child.pid);
      if (mode === 'injected-jsonl') row.arbitraryContent = 'TW_RAW_CONTENT_CANARY';
      if (mode === 'unsafe-trace-value') row.node = 'PRIVATE';
      put(env.TW_TRACE, JSON.stringify(row) + '\n');
      put(win32.join(env.TW_TRACE_HEALTH, child.pid + '.json'), JSON.stringify({ pid: child.pid, state: 'complete' }));
    }
    if (mode === 'counter-injection') put(env.TW_PARITY_COUNTER,
      '{"event":"powershell-admission","kind":"smoke","rawContent":"PRIVATE"}\n');
    if (options.consumeBudget) {
      const required = kind === 'smoke' || kind === 'parent' ? 3 : kind === 'healthy' ? 6 : 14;
      for (let index = 0; index < required; index++) put(env.TW_PARITY_COUNTER,
        files.get(env.TW_PARITY_COUNTER).toString() + JSON.stringify({ event: 'powershell-admission', kind: kind === 'smoke' ? 'smoke' : 'downstream' }) + '\n');
    }
    for (const property of options.getterThrows ?? []) Object.defineProperty(child, property, { get() { throw new Error('synthetic metadata getter'); } });
    queueMicrotask(() => {
      if (options.errorCodeGetter) {
        const error = new Error('synthetic launch error');
        Object.defineProperty(error, 'code', { get() { throw new Error('synthetic code getter'); } });
        child.emit('error', error); return;
      }
      if (options.launchErrorCode) {
        child.emit('error', Object.assign(new Error('synthetic launch error'), { code: options.launchErrorCode })); return;
      }
      if (mode === 'watchdog') { child.exitCode = null; timers.at(-2).callback(); timers.at(-1).callback(); return; }
      if (mode === 'output-limit') child.stdout.emit('data', Buffer.alloc(65537, 'x'));
      if (mode !== 'expiry') {
        const payload = probe(kind, arm, trace);
        if (mode === 'empty-probe') payload.observations = [];
        if (mode === 'probe-injection') payload.rawContent = 'TW_RAW_CONTENT_CANARY';
        child.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
      }
      child.emit('close', options.closeStatus ?? 0, options.closeSignal ?? null);
    });
    return child;
  }, spawnSync(command, args) { assert.equal(command, 'taskkill.exe'); signals.push(Number(args[1])); return { status: 128, signal: null }; } };
  const processMock = { env: { SystemRoot: 'C:\\Windows', HOME: 'HOST-HOME', USERPROFILE: 'HOST-PROFILE',
    APPDATA: 'HOST-APPDATA', LOCALAPPDATA: 'HOST-LOCALAPPDATA', PSModulePath: 'HOST-PERSONAL-MODULE', TOKEN: 'ENV-CREDENTIAL-CANARY' },
    execPath: 'C:\\node.exe', version: 'v22.22.0', versions: { uv: '1.51.0' }, platform: 'win32',
    kill(pid, signal) { assert.equal(signal, 0); if (options.historicalLive) return true;
      throw Object.assign(new Error(), { code: 'ESRCH' }); } };
  const parentAPI = api({ fs: fsMock, cp: cpMock, process: processMock,
    setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer);
      if (options.historicalLive && delay === 43000) queueMicrotask(callback); return timer; } });
  await parentAPI.runParent();
  const read = (name) => JSON.parse(files.get('C:\\repo\\docs\\native-output-parity-1000\\' + name).toString());
  const exported = [...files].filter(([path]) => path.startsWith('C:\\repo\\docs\\native-output-'));
  return { files, launches, removals, signals, timers, read, exported,
    artifactText: exported.map(([, bytes]) => bytes.toString()).join('\n') };
}

await control('R3-root-return-metadata-boundary', async () => {
  const evidence = [];
  for (const [field, options, unknown] of [
    ['normal', {}, false], ['signalCode', { signal: 'RAW-STDERR-CANARY' }, true],
    ['exitCode', { status: 'RAW-STDERR-CANARY' }, true], ['pid', { pid: 'RAW-STDERR-CANARY' }, true],
    ['error.code', { launchErrorCode: 'RAW-STDERR-CANARY' }, true],
    ['close-arguments-not-exported', { closeStatus: 'RAW-STDERR-CANARY', closeSignal: 'RAW-STDERR-CANARY' }, false],
    ['status-getter', { getterThrows: ['exitCode'] }, true], ['signal-getter', { getterThrows: ['signalCode'] }, true],
    ['pid-getter', { getterThrows: ['pid'] }, true], ['error-code-getter', { errorCodeGetter: true }, true],
    ['known-signal-not-success', { signal: 'SIGTERM' }, false]
  ]) {
    const mock = await mockParent('normal', options);
    assert(!mock.artifactText.includes('RAW-STDERR-CANARY'));
    assert(!mock.artifactText.includes('synthetic metadata getter'));
    assert(!mock.artifactText.includes('synthetic code getter'));
    const record = mock.read('smoke-off-E0.json');
    if (unknown || field === 'known-signal-not-success') {
      assert.equal(record.diagnosticCompleted, false);
      assert.equal(record.productResultUnknown, true);
      assert.deepEqual(Object.keys(mock.read('parity-summary.json').selectedArms), []);
    } else assert.equal(record.diagnosticCompleted, true);
    if (unknown) assert.equal(record.rootMetadataUnknown, true);
    evidence.push({ field, unsafeValuePublished: false, rootMetadataUnknown: record.rootMetadataUnknown,
      diagnosticCompleted: record.diagnosticCompleted, selectedP2Arm: Object.keys(mock.read('parity-summary.json').selectedArms).length > 0 });
  }
  return { evidence, virtualOnly: true, nativeReachability: 'unknown-not-tested' };
});
await control('R3-native-property-and-error-semantics', () => {
  const child = { pid: 123, exitCode: 0, signalCode: null };
  const snapshot = pure.rootMetadata(child);
  assert.equal(snapshot.pid, 123); assert.equal(snapshot.status, 0); assert.equal(snapshot.signal, null);
  assert.equal(snapshot.unknown, false);
  assert.deepEqual(child, { pid: 123, exitCode: 0, signalCode: null });
  for (const property of ['pid', 'exitCode', 'signalCode']) {
    const object = { ...child };
    Object.defineProperty(object, property, { get() { throw new Error('synthetic metadata getter'); } });
    assert.equal(pure.rootMetadata(object).unknown, true);
  }
  const mock = mockGuard(); mock.cpMock.spawn('node.exe', []);
  const error = Object.assign(new Error('original synthetic native error'), { code: 'RAW-STDERR-CANARY' });
  assert.throws(() => mock.child.emit('error', error), (value) => value === error);
  assert.equal(mock.child.listenerCount('error'), 0);
  assert.equal(mock.cpMock.spawnSync('node.exe', []), mock.syncResult);
  return { nativeObjectUntouched: true, getterFailuresBecomeUnknown: true, errorMonitorSemanticsUnchanged: true };
});
const output = { schemaVersion: 1, role: 'supporting-generator-r3-controls-not-independent-verdict',
  r2BaseHead: 'd1df23737b49acabcb4c5823f75944b378b4e038', sourceScriptSha256: sourceHash,
  controls: results, node: process.version, platform: process.platform,
  controlsPassed: results.every((item) => item.passed === true && item.execution === 'completed'),
  nativeWindowsExecuted: false, productRuntimeExecuted: false, allRuntimeEvidenceVirtual: true,
  releaseAcceptance: false, releaseReady: false };
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ controls: results.length, controlsPassed: output.controlsPassed, nativeWindowsExecuted: false }));
process.exitCode = output.controlsPassed ? 0 : 1;
