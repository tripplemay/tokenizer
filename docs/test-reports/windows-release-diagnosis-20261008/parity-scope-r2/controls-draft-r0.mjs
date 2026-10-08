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
    'safeCode, errorCode, evidenceEvent, publicJsonl, validProbe, probeCoverage, counts, installGuard, readRows, healthStates, runParent })', context);
}
const pure = api();
const plain = (value) => JSON.parse(JSON.stringify(value));
const results = [];
async function control(id, action) {
  try { results.push({ id, execution: 'completed', passed: true, violation: false, ...await action() }); }
  catch (error) { results.push({ id, execution: 'failed', passed: false, violation: true,
    errorClass: error.constructor.name, assertionMessage: error.message }); }
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
    const child = new EventEmitter(); Object.assign(child, { pid: ++childNumber,
      exitCode: mode === 'expiry' ? 92 : 0, signalCode: options.signal ?? null,
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
    queueMicrotask(() => {
      if (mode === 'watchdog') { child.exitCode = null; timers.at(-2).callback(); timers.at(-1).callback(); return; }
      if (mode === 'output-limit') child.stdout.emit('data', Buffer.alloc(65537, 'x'));
      if (mode !== 'expiry') {
        const payload = probe(kind, arm, trace);
        if (mode === 'empty-probe') payload.observations = [];
        if (mode === 'probe-injection') payload.rawContent = 'TW_RAW_CONTENT_CANARY';
        child.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
      }
      child.emit('close', child.exitCode, child.signalCode);
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

await control('C01-exact-commit-and-allowed-tree', () => {
  if (exactSource === 'DRAFT') return { finalGateEligible: false, gitHead: git('rev-parse', 'HEAD'), sourceHash };
  assert.equal(git('rev-parse', 'HEAD'), exactSource);
  assert.equal(hash(fs.readFileSync(join(repo, cliPath))), sourceHash);
  assert.equal(git('merge-base', r1Source, exactSource), r1Source);
  const paths = git('diff', '--name-only', r1Source, exactSource).split('\n');
  for (const path of paths) assert(path === cliPath || path.startsWith('docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r2/') ||
    (path.startsWith('docs/test-reports/windows-release-diagnosis-20261008/parity-scope-r1/') && Object.hasOwn(r1Hashes, path.split('/').at(-1))));
  assert.equal(git('rev-parse', exactSource + ':.github/workflows/windows-release-diagnostics.yml'),
    git('rev-parse', r1Source + ':.github/workflows/windows-release-diagnostics.yml'));
  return { finalGateEligible: true, changedPaths: paths, uniqueTree: git('rev-parse', exactSource + '^{tree}'), sourceHash };
});
await control('C02-frozen-products-evidence-workflow', () => {
  const candidate = exactSource === 'DRAFT' ? r1Source : exactSource;
  const frozenPaths = ['src', 'tests', 'app', 'prisma', 'package.json', 'package-lock.json', 'progress.json', 'features.json', 'backlog.json',
    'docs/specs/BL-WINDOWS-NATIVE-DIAGNOSTIC-spec.md', '.github/workflows',
    'docs/test-reports/windows-release-diagnosis-20261008/native-diagnostics.mjs',
    'docs/test-reports/windows-release-diagnosis-20261008/trace-preload.mjs',
    'docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1',
    'docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r1'];
  const objects = frozenPaths.map((path) => ({ path, base: git('rev-parse', r1Source + ':' + path),
    candidate: git('rev-parse', candidate + ':' + path) }));
  for (const object of objects) assert.equal(object.base, object.candidate);
  for (const [filename, digest] of Object.entries(r1Hashes)) assert.equal(hash(fs.readFileSync(join(here, '../parity-scope-r1', filename))), digest);
  const reportPath = 'docs/test-reports/windows-release-diagnosis-20261008/native-findings-r1';
  const inventory = JSON.parse(git('show', candidate + ':' + reportPath + '/analysis.json')).evidenceInventory;
  assert.equal(inventory.length, 32);
  for (const item of inventory) {
    const bytes = cp.execFileSync('git', ['show', candidate + ':' + reportPath + '/' + item.path], { cwd: repo });
    assert.equal(hash(bytes), item.sha256);
    assert.equal(hash(fs.readFileSync(join(repo, reportPath, item.path))), item.sha256);
  }
  return { frozenObjects: objects, r1EvidenceHashes: r1Hashes, originalHashesVerified: 32 };
});
await control('C03-environment-bounds-and-case-admission', async () => {
  assert.deepEqual(plain(pure.BOUNDS), { totalMs: 600000, caseMs: 40000, cleanupMs: 3000, operationMs: 10000,
    smokeChildMs: 7000, smokePs: 38, totalPs: 76, outputBytes: 65536, traceBytes: 524288, attributeBytes: 16384 });
  const arms = Object.keys(pure.ARM_KEYS);
  assert.deepEqual(arms, ['E0', 'E1', 'E2', 'E3', 'E4']);
  for (const arm of arms) {
    const result = pure.armEnvironment({ SystemRoot: 'C:\\Windows' }, arm, 'C:\\synthetic');
    assert.deepEqual(plain(result.changedKeys), pure.ARM_KEYS[arm] ? [pure.ARM_KEYS[arm]] : []);
    if (arm === 'E4') assert.equal(result.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  }
  assert.equal(pure.admission({ now: 0, deadline: 42999, usedTotal: 0, usedSmoke: 0, requiredPs: 3, smoke: true }), 'global-cleanup-output-allowance-insufficient');
  assert.equal(pure.admission({ now: 0, deadline: 43000, usedTotal: 73, usedSmoke: 35, requiredPs: 3, smoke: true }), null);
  assert.equal(pure.admission({ now: 0, deadline: 600000, usedTotal: 63, usedSmoke: 30, requiredPs: 14, smoke: false }), 'total-powershell-budget-insufficient');
  const mock = await mockParent('normal', { consumeBudget: true });
  assert.deepEqual(mock.launches.slice(0, 10).map(({ id }) => id), ['off', 'on'].flatMap((trace) => arms.map((arm) => `smoke-${trace}-${arm}`)));
  assert.deepEqual(mock.launches.slice(10, 12).map(({ id }) => id), ['downstream-off-parent', 'downstream-on-parent']);
  assert.deepEqual(mock.read('parity-summary.json').selectedArms, { off: 'E0', on: 'E0' });
  for (const { env } of mock.launches) {
    assert(!Object.hasOwn(env, 'TOKEN'));
    assert(env.HOME.startsWith(env.TW_ROOT + '\\'));
    assert(env.NODE_OPTIONS.includes('?guard=1'));
    assert.equal(env.NODE_OPTIONS.includes('trace-preload.mjs'), env.TW_PARITY_TRACE === 'on');
  }
  const summary = mock.read('parity-summary.json');
  assert(summary.usedPowerShell.total <= 76 && summary.usedPowerShell.smoke <= 38);
  assert.equal(summary.optionalCombinedArmExecuted, false);
  assert.equal(summary.offMeansOldTraceOffNotUninstrumented, true);
  return { launchOrder: mock.launches.map(({ id }) => id), usedPowerShell: summary.usedPowerShell,
    denied: summary.cases.filter((item) => !item.reached), bounds: plain(pure.BOUNDS) };
});
await control('C04-logger-native-return-exception-errorMonitor', () => {
  const modes = ['normal', 'logger-stat', 'logger-append', 'health-failure', 'native-throw', 'sync-throw'];
  for (const mode of modes) {
    const mock = mockGuard(mode);
    if (mode === 'native-throw') assert.throws(() => mock.cpMock.spawn('node.exe', []), (error) => error === mock.nativeError);
    else if (mode === 'sync-throw') assert.throws(() => mock.cpMock.spawnSync('node.exe', []), (error) => error === mock.nativeError);
    else {
      assert.equal(mock.cpMock.spawn('powershell.exe', []), mock.child);
      assert.equal(mock.cpMock.spawnSync('node.exe', []), mock.syncResult);
      assert.throws(() => mock.child.emit('error', mock.nativeError), (error) => error === mock.nativeError);
      assert.equal(mock.child.listenerCount('error'), 0);
      assert.equal(mock.child.listenerCount('data'), 0);
    }
  }
  const guardSource = source.slice(source.indexOf('function installGuard('), source.indexOf('\nfunction readRows('));
  assert(!/\.on\(['"]data['"]/.test(guardSource));
  return { modes, nativeReturnAndThrownIdentityPreserved: true, ordinaryErrorNotSwallowed: true, guardStreamObserver: false };
});
await control('C05-owned-cleanup-and-common-launchbudget', () => {
  const live = mockGuard(); live.cpMock.spawn('node.exe', []); live.expire();
  assert.equal(live.child.killCalls, 1); assert.equal(live.syncCalls(), 1); assert.equal(live.exitCode(), 92);
  const expired = JSON.parse(live.files.get('C:\\run\\case\\log').trim().split('\n').at(-1));
  assert.equal(expired.event, 'diagnostic-budget-abort'); assert.equal(expired.reason, 'owned-lifetime-expired');
  const closed = mockGuard(); closed.cpMock.spawn('node.exe', []); closed.child.exitCode = 0; closed.expire();
  assert.equal(closed.child.killCalls, 0); assert.equal(closed.syncCalls(), 0);
  const checks = [];
  for (const [mode, count, reason] of [['total', 76, 'total-powershell-budget-insufficient'], ['smoke', 38, 'smoke-powershell-budget-insufficient']]) {
    const mock = mockGuard(); mock.files.set('C:\\run\\counter', Array.from({ length: count }, () => JSON.stringify({ event: 'powershell-admission', kind: mode === 'total' ? 'downstream' : 'smoke' })).join('\n'));
    assert.throws(() => mock.cpMock.spawn('powershell.exe', []), { code: 'TW_PARITY_BUDGET' });
    assert.equal(mock.spawnCalls(), 0);
    assert.equal(JSON.parse(mock.files.get('C:\\run\\case\\log').trim().split('\n').at(-1)).reason, reason);
    checks.push(reason);
  }
  const sync = mockGuard(); assert.throws(() => sync.cpMock.spawnSync('powershell.exe', []), { code: 'TW_PARITY_BUDGET' }); assert.equal(sync.syncCalls(), 0);
  const failed = mockGuard('counter-failure'); assert.throws(() => failed.cpMock.spawn('powershell.exe', []), { code: 'TW_PARITY_BUDGET' }); assert.equal(failed.spawnCalls(), 0);
  const state = JSON.parse(failed.files.get('C:\\run\\case\\health\\101.json'));
  assert.equal(state.state, 'failed'); assert.equal(state.reasonCode, 'GUARD_COUNTER_IO');
  return { activeHandleKillCalls: 1, closedHandleKillCalls: 0, taskkill128NotInterpreted: true, checks,
    counterLoggerFailureStopsAdmission: true, synchronousPowerShellBlocked: true };
});
await control('C06-R1-expiry-plus-watchdog-budget-output-notreached', async () => {
  const evidence = [];
  for (const mode of ['expiry', 'budget', 'watchdog', 'output-limit']) {
    const mock = await mockParent(mode), record = mock.read('smoke-off-E0.json'), cleanup = mock.read('smoke-off-E0.cleanup.json');
    assert.equal(record.classification, 'diagnostic-budget-not-reached'); assert.equal(record.reached, false);
    assert.equal(record.productResultUnknown, true); assert.equal(record.diagnosticCompleted, false);
    assert.equal(cleanup.productCleanupFailure, 'not-inferred');
    evidence.push({ mode, classification: record.classification, reached: record.reached,
      diagnosticAbortReasons: record.diagnosticAbortReasons, cleanupUnknown: cleanup.cleanupUnknown,
      cleanupUnknownBasis: cleanup.cleanupUnknownBasis });
  }
  return { evidence, originalR1C06Reexecuted: true };
});
await control('C07-R1-injection-artifact-boundary-all-families', async () => {
  const evidence = [];
  for (const mode of ['injected-jsonl', 'unsafe-guard-value', 'unsafe-trace-value', 'counter-injection', 'probe-injection']) {
    const mock = await mockParent(mode);
    assert(!/rawStderr|unknownSecretKey|arbitraryContent|rawContent|RAW-STDERR-CANARY|PRIVATE|TW_RAW_CONTENT_CANARY|ENV-CREDENTIAL-CANARY/.test(mock.artifactText));
    assert.equal(mock.read('parity-summary.json').diagnosticCompleted, false);
    evidence.push({ mode, publishedCanary: false, diagnosticCompleted: false,
      jsonlArtifacts: mock.exported.filter(([path]) => path.endsWith('.jsonl')).length });
  }
  const samples = { guard: baseGuard(), trace: baseTrace(), counter: { event: 'powershell-admission', kind: 'smoke' } };
  for (const [family, sample] of Object.entries(samples)) {
    assert(pure.evidenceEvent(family, sample));
    assert.equal(pure.publicJsonl(family, [{ ...sample, unknown: 'PRIVATE' }]), null);
    assert.equal(pure.publicJsonl(family, [{ ...sample, event: 'RAW-STDERR-CANARY' }]), null);
  }
  const safeRows = await mockParent();
  for (const [path, bytes] of safeRows.exported.filter(([path]) => /\.(?:guard|trace)\.jsonl$/.test(path))) {
    const family = path.endsWith('.guard.jsonl') ? 'guard' : 'trace';
    for (const row of bytes.toString().trim().split('\n').map(JSON.parse)) assert(pure.evidenceEvent(family, row));
  }
  return { evidence, safeRowsRevalidated: true, originalR1C07Reexecuted: true,
    allEvidenceVirtual: true, actualHostSecretAccess: false };
});
await control('C08-R1-unsafe-error-code-native-behavior', () => {
  const mock = mockGuard(); mock.cpMock.spawn('node.exe', []);
  const error = Object.assign(new Error('synthetic message'), { code: 'RAW-STDERR-CANARY' });
  assert.throws(() => mock.child.emit('error', error), (observed) => observed === error);
  assert(!mock.files.get('C:\\run\\case\\log').includes('RAW-STDERR-CANARY'));
  assert.equal(JSON.parse(mock.files.get('C:\\run\\case\\log').trim().split('\n').at(-1)).code, 'UNRECOGNIZED_ERROR_CODE');
  assert.equal(JSON.parse(mock.files.get('C:\\run\\case\\health\\101.json')).state, 'failed');
  assert.equal(mock.guarded.errorCode(Object.defineProperty({}, 'code', { get() { throw error; } })), 'UNRECOGNIZED_ERROR_CODE');
  assert.equal(mock.child.listenerCount('error'), 0);
  return { nativeErrorIdentityPreserved: true, rawFixtureLogged: false, healthFailClosed: true, originalR1C08Reexecuted: true };
});
await control('C09-R1-protocol-completeness-and-P2-selection', async () => {
  for (const kind of ['smoke', 'parent', 'confirmation', 'binding', 'healthy']) {
    const payload = probe(kind); assert.equal(pure.validProbe(payload, kind, 'E0', 'off'), true);
    for (const observations of [[], [{}], payload.observations.slice(1), [...payload.observations].reverse(), [...payload.observations, payload.observations[0]]]) {
      assert.equal(pure.validProbe({ ...payload, observations }, kind, 'E0', 'off'), false);
    }
    assert.equal(pure.validProbe({ ...payload, unknown: 'PRIVATE' }, kind, 'E0', 'off'), false);
  }
  const payload = probe();
  payload.observations[1] = measuredFail('P1');
  payload.observations[2] = { stage: 'P2', reached: false, reason: 'previous-smoke-did-not-complete' };
  assert.equal(pure.validProbe({ ...payload, p2Succeeded: false }, 'smoke', 'E0', 'off'), true);
  assert.equal(pure.validProbe({ ...payload, p2Succeeded: true }, 'smoke', 'E0', 'off'), false);
  const mock = await mockParent('empty-probe');
  assert.deepEqual(mock.read('parity-summary.json').selectedArms, {});
  assert.equal(mock.launches.length, 10);
  assert.equal(mock.read('smoke-off-E0.json').protocolValid, false);
  return { emptyObservationsRejected: true, malformedAndOutOfOrderRejected: true,
    emptyProbeSelectedArms: {}, downstreamLaunchesAfterEmptyProbe: 0, originalR1C09Reexecuted: true };
});
await control('C10-ownedbinding-loggerunknown-and-no-historical-kill', async () => {
  assert(source.includes("bindingAllowed = join(root, 'binding-allowed'), bindingProject = join(bindingAllowed, 'project'), bindingDifferent = join(root, 'binding-different')"));
  assert(!source.includes("'/allowed/project'"));
  const logger = await mockParent('logger-health');
  const record = logger.read('smoke-off-E0.json');
  assert.equal(record.abortProvenanceUnknown, true); assert.equal(record.productResultUnknown, true);
  assert.equal(record.diagnosticCompleted, false); assert.equal(record.classification, 'diagnostic-incomplete-provenance-unknown');
  const history = await mockParent('normal', { historicalLive: true });
  assert.equal(history.signals.length, 0);
  assert.equal(history.read('smoke-off-E0.cleanup.json').historicalPidsSignalled, false);
  assert.equal(history.read('smoke-off-E0.cleanup.json').cleanupUnknown, true);
  return { bindingPathsOwnedRootDerived: true, loggerFailureUnknownNotProductFailure: true,
    historicalLivenessOnlySignal0: true, historicalPidsSignalled: false };
});
await control('C11-parent-exported-return-metadata-value-boundary', async () => {
  const mock = await mockParent('normal', { signal: 'RAW-STDERR-CANARY' });
  assert(!mock.artifactText.includes('RAW-STDERR-CANARY'), 'Root process signal metadata exported arbitrary raw canary');
  return { rootSignalCanarySuppressed: true };
});
await control('C12-static-workflow-and-syntax', () => {
  cp.execFileSync(process.execPath, ['--check', join(repo, cliPath)]);
  cp.execFileSync('/opt/homebrew/bin/actionlint', ['.github/workflows/windows-release-diagnostics.yml'], { cwd: repo });
  const workflow = fs.readFileSync(join(repo, '.github/workflows/windows-release-diagnostics.yml'), 'utf8');
  assert.equal(hash(workflow), hash(cp.execFileSync('git', ['show', r1Source + ':.github/workflows/windows-release-diagnostics.yml'], { cwd: repo })));
  return { nodeSyntaxExitCode: 0, actionlintExitCode: 0, workflowByteFrozenToR1: true };
});

const currentHash = hash(fs.readFileSync(join(repo, cliPath)));
const output = { schemaVersion: 1, role: 'supporting-independent-scope-critic-controls',
  reviewState: exactSource === 'DRAFT' ? 'DRAFT_NOT_A_GATE' : 'FROZEN_COMMITTED_SOURCE', exactSource,
  r1Source, scopeBase, scriptSha256: sourceHash, sourceUnchangedDuringControls: currentHash === sourceHash,
  controlScriptSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), node: process.version, platform: process.platform,
  controls: results, violation: results.some((item) => item.violation),
  controlExecutionFailure: results.some((item) => item.execution === 'failed'),
  nativeWindowsExecuted: false, productRuntimeExecuted: false, realServicesExecuted: false,
  allRuntimeEvidenceVirtual: true, releaseAcceptance: false, productAcceptance: false, nativeAcceptance: false, releaseReady: false };
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ reviewState: output.reviewState, output: outputName, scriptSha256: sourceHash,
  violation: output.violation, failed: results.filter((item) => !item.passed).map(({ id, assertionMessage }) => ({ id, assertionMessage })) }));
process.exitCode = output.violation || !output.sourceUnchangedDuringControls ? 1 : 0;
