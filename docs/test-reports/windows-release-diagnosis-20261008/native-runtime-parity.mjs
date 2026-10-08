import fs from 'node:fs';
import cp from 'node:child_process';
import { errorMonitor } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve, relative, isAbsolute, basename, dirname, parse, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export const BOUNDS = Object.freeze({ totalMs: 600_000, caseMs: 40_000, cleanupMs: 3_000,
  operationMs: 10_000, smokeChildMs: 7_000, smokePs: 38, totalPs: 76,
  outputBytes: 65_536, traceBytes: 524_288, attributeBytes: 16_384 });
export const SOURCE_FREEZE = '7c6936b97a54f13d1ceb3272f810cf51d28a34f1';
export const ARM_KEYS = Object.freeze({ E0: null, E1: 'SystemDrive', E2: 'APPDATA', E3: 'LOCALAPPDATA', E4: 'PSModulePath' });
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const self = fileURLToPath(new URL('./native-runtime-parity.mjs', import.meta.url));
const guardUrl = pathToFileURL(self); guardUrl.searchParams.set('guard', '1');
const traceUrl = pathToFileURL(join(here, 'trace-preload.mjs')).href;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const rawCanary = 'TW_RAW_CONTENT_CANARY';
export const NATIVE_SCRIPT = "$ErrorActionPreference='Stop'; foreach($p in (ConvertFrom-Json $env:TOKENIZER_REPLAY_PATHS)) { if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' } }; 'TOKENIZER_REPLAY_NO_REPARSE_V1'";
const owned = (root, path) => typeof path === 'string' && (path === root ||
  (!relative(root, path).startsWith('..') && !isAbsolute(relative(root, path))));

export function armEnvironment(base, arm, root) {
  assert(Object.hasOwn(ARM_KEYS, arm), 'unknown arm');
  const env = { ...base };
  if (arm === 'E1') {
    assert(/^[a-z]:[\\/]/i.test(base.SystemRoot ?? ''), 'local-drive SystemRoot required');
    env.SystemDrive = win32.parse(base.SystemRoot).root.slice(0, 2);
  }
  if (arm === 'E2') env.APPDATA = join(root, 'appdata');
  if (arm === 'E3') env.LOCALAPPDATA = join(root, 'localappdata');
  if (arm === 'E4') {
    assert(/^[a-z]:[\\/]/i.test(base.SystemRoot ?? ''), 'local-drive SystemRoot required');
    env.PSModulePath = win32.join(base.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  }
  const changedKeys = [...new Set([...Object.keys(base), ...Object.keys(env)])]
    .filter((key) => base[key] !== env[key]).sort();
  assert.deepEqual(changedKeys, ARM_KEYS[arm] ? [ARM_KEYS[arm]] : []);
  return { env, changedKeys };
}

export function admission({ now, deadline, usedTotal, usedSmoke, requiredPs, smoke }) {
  if (deadline - now < BOUNDS.caseMs + BOUNDS.cleanupMs) return 'global-cleanup-output-allowance-insufficient';
  if (usedTotal + requiredPs > BOUNDS.totalPs) return 'total-powershell-budget-insufficient';
  if (smoke && usedSmoke + requiredPs > BOUNDS.smokePs) return 'smoke-powershell-budget-insufficient';
  return null;
}

function counts(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert(lines.every((entry) => entry.event === 'powershell-admission' && ['smoke', 'downstream'].includes(entry.kind)));
  return { total: lines.length, smoke: lines.filter((entry) => entry.kind === 'smoke').length };
}

// Both forms retain this budget/lifetime guard. Only the old trace preload is crossed off/on.
function installGuard() {
  const root = process.env.TW_ROOT, runRoot = process.env.TW_PARITY_RUN_ROOT;
  const logFile = process.env.TW_PARITY_GUARD_LOG, healthDirectory = process.env.TW_PARITY_GUARD_HEALTH;
  const counter = process.env.TW_PARITY_COUNTER;
  const caseDeadline = Number(process.env.TW_PARITY_CASE_DEADLINE), totalDeadline = Number(process.env.TW_PARITY_TOTAL_DEADLINE);
  if (!root || !runRoot || !owned(runRoot, root) || !owned(root, logFile) || !owned(root, healthDirectory) ||
      !owned(runRoot, counter) || !Number.isSafeInteger(caseDeadline) || !Number.isSafeInteger(totalDeadline)) throw new Error('owned parity guard configuration required');
  const append = fs.appendFileSync, write = fs.writeFileSync;
  const originalSpawn = cp.spawn, originalSpawnSync = cp.spawnSync;
  const healthPath = join(healthDirectory, process.pid + '.json');
  let failed = false, reasonCode = null, sequence = 0, stopping = false;
  const health = (state) => {
    try { write(healthPath, JSON.stringify({ pid: process.pid, state, ...(reasonCode ? { reasonCode } : {}) }) + '\n'); }
    catch { failed = true; reasonCode ??= 'GUARD_HEALTH_IO'; }
  };
  const log = (event) => {
    try {
      if (fs.statSync(logFile).size >= BOUNDS.traceBytes) throw Object.assign(new Error(), { code: 'GUARD_LOG_LIMIT' });
      append(logFile, JSON.stringify({ pid: process.pid, sequence: sequence++, at: Date.now(), ...event }) + '\n');
    } catch { failed = true; reasonCode ??= 'GUARD_LOG_IO_OR_LIMIT'; health('failed'); }
  };
  health('pending');
  process.once('exit', () => health(failed ? 'failed' : 'complete'));
  const children = new Set();
  const active = (child) => child.pid && child.exitCode === null && child.signalCode === null;
  const stopOwnedHandle = (child) => {
    if (!active(child)) return;
    // The target is the still-live child handle, not a PID read from history.
    try { originalSpawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore', timeout: 1_000, killSignal: 'SIGKILL' }); } catch { /* independently reported as unknown */ }
    try { child.kill('SIGKILL'); } catch { /* independently reported as unknown */ }
  };
  const expiry = Math.min(caseDeadline, totalDeadline);
  const timer = setTimeout(() => {
    if (stopping) return;
    stopping = true;
    log({ event: 'owned-lifetime-expired' });
    // Concurrent child handles are bounded by the explicit diagnostic cases.
    for (const child of children) stopOwnedHandle(child);
    process.exit(92);
  }, Math.max(1, expiry - Date.now()));
  timer.unref();
  const executable = (command) => typeof command === 'string' && /^(node(?:\.exe)?|powershell\.exe|taskkill\.exe|git(?:\.exe)?)$/i.test(basename(command)) ? basename(command).toLowerCase() : 'other';
  cp.spawn = function (command, args, options) {
    const exe = executable(command);
    if (exe === 'powershell.exe') {
      let timeoutMs;
      try { timeoutMs = JSON.parse(process.argv[2]).timeoutMs; } catch { /* no budget => no launch */ }
      let reason = null;
      try {
        const used = counts(counter);
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > BOUNDS.operationMs) reason = 'unknown-native-budget';
        else if (Math.min(expiry, totalDeadline) - Date.now() < timeoutMs + BOUNDS.cleanupMs) reason = 'native-cleanup-output-allowance-insufficient';
        else if (used.total >= BOUNDS.totalPs) reason = 'total-powershell-budget-insufficient';
        else if (process.env.TW_PARITY_KIND === 'smoke' && used.smoke >= BOUNDS.smokePs) reason = 'smoke-powershell-budget-insufficient';
        if (!reason) append(counter, JSON.stringify({ event: 'powershell-admission', kind: process.env.TW_PARITY_KIND }) + '\n');
      } catch { reason = 'native-budget-counter-unavailable'; failed = true; reasonCode ??= 'GUARD_COUNTER_IO'; health('failed'); }
      if (reason) {
        log({ event: 'diagnostic-budget-abort', reason });
        throw Object.assign(new Error('diagnostic-budget-not-reached'), { code: 'TW_PARITY_BUDGET' });
      }
    }
    const child = originalSpawn.call(this, command, args, options);
    children.add(child);
    log({ event: 'spawn', executable: exe, childPid: child.pid ?? null, detached: options?.detached ?? false });
    child.on(errorMonitor, (error) => log({ event: 'child-error', executable: exe, childPid: child.pid ?? null, code: error.code ?? null }));
    child.on('exit', (status, signal) => log({ event: 'child-exit', executable: exe, childPid: child.pid, status, signal }));
    child.on('close', (status, signal) => { children.delete(child); log({ event: 'child-close', executable: exe, childPid: child.pid, status, signal }); });
    return child;
  };
  cp.spawnSync = function (command, args, options) {
    // Product launches PowerShell through the async worker. Never bypass that accounting.
    if (executable(command) === 'powershell.exe') {
      log({ event: 'diagnostic-budget-abort', reason: 'unexpected-synchronous-powershell' });
      throw Object.assign(new Error('diagnostic-budget-not-reached'), { code: 'TW_PARITY_BUDGET' });
    }
    const result = originalSpawnSync.call(this, command, args, options);
    log({ event: 'spawn-sync', executable: executable(command), childPid: result.pid ?? null,
      status: result.status, signal: result.signal, code: result.error?.code ?? null });
    return result;
  };
  syncBuiltinESMExports();
  log({ event: 'guard-preload', commonBudgetGuardOn: true, oldTracePreloadOn: process.env.TW_PARITY_TRACE === 'on' });
}

function readRows(path, maximum = BOUNDS.traceBytes) {
  let bytes;
  try { bytes = fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0); }
  catch { return { rows: [], invalid: true, readFailed: true, bytes: Buffer.alloc(0) }; }
  if (bytes.length > maximum) return { rows: [], invalid: true, bytes };
  try { return { rows: bytes.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse), invalid: false, bytes }; }
  catch { return { rows: [], invalid: true, bytes }; }
}

export function validProbe(value, kind, arm, trace) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.case !== kind || value.arm !== arm ||
      value.commonBudgetGuardOn !== true || value.releaseAcceptance !== false) return false;
  if (value.probeSetupComplete === false) return Object.keys(value).every((key) =>
    ['case', 'arm', 'commonBudgetGuardOn', 'probeSetupComplete', 'code', 'releaseAcceptance'].includes(key)) && /^[A-Z0-9_]{1,64}$/.test(value.code);
  if (value.oldTracePreload !== trace || value.operationBudgetMs !== BOUNDS.operationMs || typeof value.p2Succeeded !== 'boolean' ||
      !Array.isArray(value.observations) || value.observations.length > 64 ||
      Object.keys(value).some((key) => !['case', 'arm', 'oldTracePreload', 'commonBudgetGuardOn', 'operationBudgetMs', 'p2Succeeded', 'observations', 'releaseAcceptance'].includes(key))) return false;
  const stages = ['P0', 'P1', 'P2', 'afterPathStat', 'afterRead', 'afterPathStat-hook', 'afterRead-hook',
    'preview', 'execute', 'preview-read-only', 'queue', 'bad-digest', 'privacy-scope', 'projectRoots', 'privacy-mode', 'source-content', 'merge-count'];
  const booleans = ['reached', 'ok', 'hookReached', 'unchanged', 'executeEntered', 'containsCanary', 'retained',
    'warmSingleProductProcessNotOriginalColdProbeParity', 'zeroDoesNotProveUnreachedNegative'];
  const enums = { classification: ['diagnostic-budget-not-reached', 'observed-native-or-product-refusal'],
    reason: ['previous-smoke-did-not-complete', 'preview-did-not-complete'],
    refusalKind: [null, 'unsafe-open', 'parent-changed', 'stale-confirmation', 'deadline', 'source-changed', 'reparse-check', 'other-refusal'],
    errorClass: ['Error', 'TypeError', 'RangeError', 'AssertionError', 'BoundedSubprocessTimeoutError', 'BoundedSubprocessLaunchError', 'BoundedSubprocessOutputError', 'BoundedSubprocessSupervisionError'],
    hookStep: ['not-entered', 'rename', 'mkdir', 'hardlink', 'complete'] };
  return value.observations.every((event) => event && stages.includes(event.stage) && Object.entries(event).every(([key, item]) => {
    if (key === 'stage') return true;
    if (booleans.includes(key)) return typeof item === 'boolean';
    if (['elapsedMs', 'mergeCalls'].includes(key)) return typeof item === 'number' && Number.isFinite(item) && item >= 0;
    if (Object.hasOwn(enums, key)) return enums[key].includes(item);
    if (['code', 'hookCode'].includes(key)) return item === null || (typeof item === 'string' && /^[A-Z0-9_]{1,64}$/.test(item));
    if (key === 'value') return item && Object.entries(item).every(([name, content]) => {
      if (['fixedMarkerMatched', 'hasDigest'].includes(name)) return typeof content === 'boolean';
      if (name === 'signal') return content === null;
      return ['status', 'stdoutBytes', 'stderrBytes', 'bytes', 'records', 'wouldAdmit', 'admitted', 'backlog'].includes(name) &&
        typeof content === 'number' && Number.isFinite(content) && content >= 0;
    });
    return false;
  }));
}

function healthStates(directory, expected) {
  const states = [], missingPids = [];
  for (const pid of [...expected]) {
    try {
      const bytes = fs.readFileSync(join(directory, pid + '.json'));
      assert(bytes.length < 1024);
      const state = JSON.parse(bytes);
      assert(state.pid === pid && ['complete', 'pending', 'failed'].includes(state.state));
      assert(Object.keys(state).every((key) => ['pid', 'state', 'reasonCode'].includes(key)));
      assert(state.reasonCode === undefined || /^[A-Z0-9_]{1,64}$/.test(state.reasonCode));
      states.push(state);
    } catch { missingPids.push(pid); }
  }
  return { states, missingPids, complete: missingPids.length === 0 && states.every((state) => state.state === 'complete') };
}

async function runParent() {
  const output = join(here, 'native-output-parity-' + Date.now()); fs.mkdirSync(output);
  const runRoot = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'twp-')));
  const counter = join(runRoot, 'counter.jsonl'); fs.writeFileSync(counter, '');
  const deadline = Date.now() + BOUNDS.totalMs;
  const baseSystem = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
    const match = Object.keys(process.env).find((name) => name.toLowerCase() === key.toLowerCase());
    if (match) baseSystem[key] = process.env[match];
  }
  assert(/^[a-z]:[\\/]/i.test(baseSystem.SystemRoot ?? ''), 'local-drive SystemRoot required');
  const records = [], selected = {}, retainedRoots = [];
  let diagnosticIncomplete = false;
  const notReached = (id, arm, trace, reason) => {
    const record = { id, arm, oldTracePreload: trace, commonBudgetGuardOn: true,
      reached: false, classification: 'diagnostic-budget-not-reached', reason, releaseAcceptance: false };
    records.push(record); fs.writeFileSync(join(output, id + '.json'), JSON.stringify(record) + '\n');
  };
  const runCase = async (id, arm, trace, kind, requiredPs) => {
    let used;
    try { used = counts(counter); } catch { diagnosticIncomplete = true; notReached(id, arm, trace, 'counter-unavailable'); return null; }
    const denied = admission({ now: Date.now(), deadline, usedTotal: used.total, usedSmoke: used.smoke, requiredPs, smoke: kind === 'smoke' });
    if (denied) { diagnosticIncomplete = true; notReached(id, arm, trace, denied); return null; }
    const root = join(runRoot, id); fs.mkdirSync(root);
    for (const dir of ['home', 'tmp', 'appdata', 'localappdata', 'guard-health', 'trace-health']) fs.mkdirSync(join(root, dir));
    const traceFile = join(root, 'trace.jsonl'), guardFile = join(root, 'guard.jsonl'); fs.writeFileSync(guardFile, '');
    let caseDeadline = Date.now() + BOUNDS.caseMs;
    const base = { ...baseSystem, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'),
      TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'),
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'home/empty-gitconfig'), GIT_TERMINAL_PROMPT: '0',
      TW_ROOT: root, TW_TRACE: traceFile, TW_TRACE_HEALTH: join(root, 'trace-health'),
      TW_PARITY_RUN_ROOT: runRoot, TW_PARITY_COUNTER: counter, TW_PARITY_GUARD_LOG: guardFile,
      TW_PARITY_GUARD_HEALTH: join(root, 'guard-health'), TW_PARITY_CASE_DEADLINE: String(caseDeadline),
      TW_PARITY_TOTAL_DEADLINE: String(deadline), TW_PARITY_KIND: kind,
      TW_PARITY_ARM: arm, TW_PARITY_TRACE: trace, TW_PARITY_CASE: kind === 'smoke' ? 'smoke' : id.split('-').at(-1),
      NODE_OPTIONS: '--import=' + guardUrl.href + (trace === 'on' ? ' --import=' + traceUrl : '') };
    fs.writeFileSync(base.GIT_CONFIG_GLOBAL, '');
    const { env, changedKeys } = armEnvironment(base, arm, root);
    // Synthetic directory setup can consume time. Re-admit immediately before native launch.
    const latest = counts(counter);
    const launchDenied = admission({ now: Date.now(), deadline, usedTotal: latest.total, usedSmoke: latest.smoke, requiredPs, smoke: kind === 'smoke' });
    if (launchDenied) {
      diagnosticIncomplete = true; notReached(id, arm, trace, launchDenied);
      fs.rmSync(root, { recursive: true, force: true }); return null;
    }
    caseDeadline = Math.min(Date.now() + BOUNDS.caseMs, deadline - BOUNDS.cleanupMs);
    base.TW_PARITY_CASE_DEADLINE = env.TW_PARITY_CASE_DEADLINE = String(caseDeadline);
    let rootPid;
    const result = await new Promise((done) => {
      const child = cp.spawn(process.execPath, ['--import', 'tsx', self, '--probe'], { cwd: repo, env, windowsHide: true });
      rootPid = child.pid;
      let settled = false, stopped = false, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), bytes = 0, launchCode = null;
      const finish = () => {
        if (settled) return; settled = true; clearTimeout(watchdog); clearTimeout(finalTimer);
        const text = Buffer.concat([stdout, stderr]).toString('utf8');
        const canaries = { rawContentFound: text.includes(rawCanary), credentialFound: /PRIVATE|reader/.test(text), rawStderrFound: text.includes('RAW-STDERR-CANARY') };
        let reported = null;
        try {
          if (!Object.values(canaries).some(Boolean)) {
            const candidate = JSON.parse(stdout.toString('utf8'));
            if (validProbe(candidate, kind === 'smoke' ? 'smoke' : id.split('-').at(-1), arm, trace)) reported = candidate;
          }
        } catch { /* no raw fallback */ }
        done({ status: child.exitCode, signal: child.signalCode, stopped, launchCode, stdoutBytes: stdout.length,
          stderrBytes: stderr.length, canaries, canaryCoverageComplete: bytes <= BOUNDS.outputBytes,
          reported, protocolValid: Boolean(reported), outputBoundExceeded: bytes > BOUNDS.outputBytes });
      };
      const stop = () => {
        if (stopped) return; stopped = true;
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          try { cp.spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { timeout: 1_000, stdio: 'ignore', windowsHide: true, killSignal: 'SIGKILL' }); } catch { /* unknown cleanup remains separate */ }
          try { child.kill('SIGKILL'); } catch { /* only the owned handle; unknown retained */ }
        }
      };
      const remainingCase = Math.max(1, caseDeadline - Date.now());
      const watchdog = setTimeout(stop, remainingCase);
      const finalTimer = setTimeout(() => { stop(); child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); finish(); }, remainingCase + BOUNDS.cleanupMs);
      for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', (chunk) => {
        bytes += chunk.length; if (bytes > BOUNDS.outputBytes) { stop(); return; }
        if (key === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
      });
      child.on(errorMonitor, (error) => { launchCode = /^[A-Z0-9_]{1,64}$/.test(error.code ?? '') ? error.code : 'LAUNCH_ERROR'; });
      // The diagnostic parent intentionally handles its own launch failure, not a product child error.
      child.on('error', () => finish());
      child.on('close', finish);
    });
    const guard = readRows(guardFile), traceRows = readRows(traceFile);
    const expected = new Set([rootPid].filter((pid) => Number.isSafeInteger(pid) && pid > 0));
    const observedPids = new Set(expected);
    for (const event of guard.rows) {
      if (event.event === 'guard-preload') expected.add(event.pid);
      if (Number.isSafeInteger(event.childPid) && event.childPid > 0) {
        observedPids.add(event.childPid);
        if (/^node(?:\.exe)?$/.test(event.executable ?? '')) expected.add(event.childPid);
      }
    }
    const possibleLive = () => [...observedPids].filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    const possibleLiveAtReturn = possibleLive();
    if (possibleLiveAtReturn.length) await new Promise((done) => setTimeout(done, Math.max(0, Math.min(caseDeadline + BOUNDS.cleanupMs, deadline) - Date.now())));
    const possibleLiveAfterOwnedCap = possibleLive();
    const guardHealth = healthStates(join(root, 'guard-health'), expected);
    const traceHealth = trace === 'on' ? healthStates(join(root, 'trace-health'), expected) : null;
    const guardAborts = guard.rows.filter((event) => event.event === 'diagnostic-budget-abort').map((event) => event.reason);
    const traceUnknown = trace === 'on' && (traceRows.invalid || traceRows.bytes.length === 0 || !traceHealth.complete);
    const cleanupUnknownBasis = [
      ...(possibleLiveAfterOwnedCap.length ? ['possible-live-historical-pid-no-signal'] : []),
      ...(result.stopped || result.status === null ? ['forced-or-unconfirmed-root-termination'] : []),
      ...(guard.rows.some((event) => event.event === 'owned-lifetime-expired') ? ['owned-lifetime-expired'] : []),
      ...(guard.invalid || guard.bytes.length === 0 || !guardHealth.complete ? ['ownership-observer-incomplete'] : [])
    ];
    const cleanupUnknown = cleanupUnknownBasis.length > 0;
    const complete = result.protocolValid && result.status === 0 && !result.stopped && !result.outputBoundExceeded &&
      !Object.values(result.canaries).some(Boolean) && !guard.invalid && guard.bytes.length > 0 && guardHealth.complete && !traceUnknown && !cleanupUnknown && guardAborts.length === 0;
    diagnosticIncomplete ||= !complete;
    const record = { id, arm, oldTracePreload: trace, commonBudgetGuardOn: true, reached: true, changedFromE0Keys: changedKeys,
      sourceFreezeHead: SOURCE_FREEZE, node: process.version, uv: process.versions.uv, platform: process.platform,
      ...result, guardAborts, diagnosticCompleted: complete, releaseAcceptance: false };
    records.push(record); fs.writeFileSync(join(output, id + '.json'), JSON.stringify(record, null, 2) + '\n');
    for (const [label, parsed] of [['guard', guard], ['trace', traceRows]]) if (parsed.bytes.length) {
      fs.writeFileSync(join(output, id + '.' + label + '.jsonl'), parsed.bytes.subarray(0, BOUNDS.traceBytes));
    }
    fs.writeFileSync(join(output, id + '.health.json'), JSON.stringify({ expectedPids: [...expected], guardHealth,
      oldTraceRequested: trace === 'on', traceHealth, traceCompletenessUnknown: traceUnknown,
      guardInvalid: guard.invalid, traceInvalid: traceRows.invalid, guardAborts,
      productCleanupConclusion: 'not-derived-from-trace-health' }) + '\n');
    fs.writeFileSync(join(output, id + '.cleanup.json'), JSON.stringify({ possibleLiveAtReturn, possibleLiveAfterOwnedCap,
      cleanupUnknown, cleanupUnknownBasis, productCleanupFailure: 'not-inferred', pidLivenessDoesNotProveWholeTree: true, historicalPidsSignalled: false,
      guardBytes: guard.bytes.length, traceBytes: traceRows.bytes.length,
      truncated: guard.bytes.length > BOUNDS.traceBytes || traceRows.bytes.length > BOUNDS.traceBytes,
      rootRetained: cleanupUnknown }) + '\n');
    if (cleanupUnknown) retainedRoots.push(id); else fs.rmSync(root, { recursive: true, force: true });
    return record;
  };
  for (const trace of ['off', 'on']) for (const arm of Object.keys(ARM_KEYS)) {
    const record = await runCase(`smoke-${trace}-${arm}`, arm, trace, 'smoke', 3);
    if (!selected[trace] && record?.reported?.p2Succeeded && record.diagnosticCompleted) selected[trace] = arm;
  }
  // One selected arm per form, fair round-robin cases, no arm or budget retries.
  for (const [kind, requiredPs] of [['parent', 3], ['confirmation', 14], ['binding', 14], ['healthy', 6]]) for (const trace of ['off', 'on']) {
    const arm = selected[trace];
    if (!arm) { notReached(`downstream-${trace}-${kind}`, null, trace, 'no-complete-P2-success-arm'); continue; }
    await runCase(`downstream-${trace}-${kind}`, arm, trace, 'downstream', requiredPs);
  }
  const used = counts(counter);
  assert(used.total <= BOUNDS.totalPs && used.smoke <= BOUNDS.smokePs);
  fs.writeFileSync(join(output, 'powershell-counter.jsonl'), fs.readFileSync(counter));
  const summary = { sourceFreezeHead: SOURCE_FREEZE, productBaseline: '76d916ba2e3a7147acda5ac9ef15fa70a9cd9958',
    node: process.version, uv: process.versions.uv, platform: process.platform, bounds: BOUNDS,
    selectedArms: selected, optionalCombinedArmExecuted: false, commonBudgetGuardOn: true,
    offMeansOldTraceOffNotUninstrumented: true, E4IsBuiltinSystemModulePathNotFullMachineParity: true,
    usedPowerShell: used, cases: records.map(({ id, reached, diagnosticCompleted, reason }) => ({ id, reached, diagnosticCompleted, reason })),
    retainedRoots, diagnosticCompleted: !diagnosticIncomplete, releaseAcceptance: false, releaseReady: false };
  fs.writeFileSync(join(output, 'parity-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (retainedRoots.length === 0) fs.rmSync(runRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ outputDirectory: basename(output), diagnosticCompleted: summary.diagnosticCompleted, releaseAcceptance: false }));
  process.exitCode = summary.diagnosticCompleted ? 0 : 1;
}

async function runProbe() {
  const root = process.env.TW_ROOT, kind = process.env.TW_PARITY_CASE;
  assert(root && process.env.HOME === join(root, 'home') && process.env.USERPROFILE === process.env.HOME, 'synthetic HOME required');
  const observations = [];
  const product = (path) => import(pathToFileURL(join(repo, path)).href);
  const guardAborts = () => readRows(process.env.TW_PARITY_GUARD_LOG).rows.filter((event) => event.event === 'diagnostic-budget-abort').length;
  const refusal = (error) => {
    const message = error.message ?? '';
    for (const [key, pattern] of [['unsafe-open', /source could not be opened safely/], ['parent-changed', /source parent changed/],
      ['stale-confirmation', /stale/], ['deadline', /exceeded.*(?:ms|deadline)|deadline exceeded/],
      ['source-changed', /source changed/], ['reparse-check', /reparse-point check failed/]]) if (pattern.test(message)) return key;
    return message.startsWith('Replay refused:') ? 'other-refusal' : null;
  };
  const measure = (stage, action, summarize = () => ({})) => {
    const beforeAborts = guardAborts(), start = performance.now();
    try { const value = action(); observations.push({ stage, reached: true, elapsedMs: performance.now() - start, ok: true, value: summarize(value) }); return value; }
    catch (error) { observations.push({ stage, reached: true, elapsedMs: performance.now() - start, ok: false,
      classification: guardAborts() > beforeAborts || error.code === 'TW_PARITY_BUDGET' ? 'diagnostic-budget-not-reached' : 'observed-native-or-product-refusal',
      errorClass: ['Error', 'TypeError', 'RangeError', 'AssertionError', 'BoundedSubprocessTimeoutError', 'BoundedSubprocessLaunchError', 'BoundedSubprocessOutputError', 'BoundedSubprocessSupervisionError'].includes(error.constructor?.name) ? error.constructor.name : 'Error',
      code: /^[A-Z0-9_]{1,64}$/.test(error.code ?? '') ? error.code : null, refusalKind: refusal(error) }); return null; }
  };
  const unreachable = (stage, reason) => observations.push({ stage, reached: false, reason });
  const file = join(root, 'source.jsonl');
  const row = (id = 'one', cwd = root) => JSON.stringify({ type: 'assistant', uuid: id, cwd,
    timestamp: '2026-10-07T12:00:00.000Z', message: { role: 'assistant', id, model: 'fixture-model', content: rawCanary,
      usage: { input_tokens: 1, output_tokens: 2 } } }) + '\n';
  let p2Succeeded = false;
  if (kind === 'smoke') {
    const { runBoundedSubprocess } = await product('src/cli/bounded-subprocess.ts');
    fs.writeFileSync(file, row());
    const parents = [];
    for (let current = dirname(file); ; current = dirname(current)) { parents.unshift(current); if (current === parse(current).root) break; }
    const smokes = [['P0', "'TW_PARITY_MARKER_V1'", 'TW_PARITY_MARKER_V1'],
      ['P1', "$ErrorActionPreference='Stop'; [void](ConvertFrom-Json '[1,2]'); 'TW_PARITY_JSON_V1'", 'TW_PARITY_JSON_V1'],
      ['P2', NATIVE_SCRIPT, 'TOKENIZER_REPLAY_NO_REPARSE_V1']];
    let previous = true;
    for (const [stage, script, marker] of smokes) {
      if (!previous) { unreachable(stage, 'previous-smoke-did-not-complete'); continue; }
      const result = measure(stage, () => {
        const value = runBoundedSubprocess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
          { env: { ...process.env, ...(stage === 'P2' ? { TOKENIZER_REPLAY_PATHS: JSON.stringify([...parents, file]) } : {}) },
            timeoutMs: BOUNDS.smokeChildMs, maxOutputBytes: BOUNDS.attributeBytes, windowsHide: true });
        if (value.status !== 0 || value.signal !== null || value.stdout.trim() !== marker) throw Object.assign(new Error('fixed smoke marker mismatch'), { code: 'TW_MARKER_MISMATCH' });
        return value;
      }, (value) => ({ status: value.status, signal: value.signal, fixedMarkerMatched: true, stdoutBytes: Buffer.byteLength(value.stdout), stderrBytes: Buffer.byteLength(value.stderr) }));
      previous = Boolean(result); if (stage === 'P2') p2Succeeded = previous;
    }
  } else if (kind === 'parent') {
    const { readBoundedReplayFile } = await product('src/cli/replay.ts');
    for (const stage of ['afterPathStat', 'afterRead']) {
      const parent = join(root, stage), moved = join(root, stage + '-moved'); fs.mkdirSync(parent);
      const source = join(parent, 'source.jsonl'); fs.writeFileSync(source, row());
      let hookReached = false, hookStep = 'not-entered', hookCode = null;
      measure(stage, () => readBoundedReplayFile(source, 100_000, { [stage]: () => {
        hookReached = true;
        try { hookStep = 'rename'; fs.renameSync(parent, moved); hookStep = 'mkdir'; fs.mkdirSync(parent);
          hookStep = 'hardlink'; fs.linkSync(join(moved, 'source.jsonl'), source); hookStep = 'complete'; }
        catch (error) { hookCode = /^[A-Z0-9_]{1,64}$/.test(error.code ?? '') ? error.code : 'NATIVE_ERROR'; throw error; }
      } }), (value) => ({ bytes: value.bytes.length, records: value.records }));
      observations.push({ stage: stage + '-hook', hookReached, hookStep, hookCode });
    }
  } else {
    assert(['confirmation', 'binding', 'healthy'].includes(kind), 'unknown probe case');
    const { dryRunBoundedReplay, executeBoundedReplay } = await product('src/cli/replay.ts');
    const { planBoundedReplay } = await product('src/cli/replay-contract.ts');
    const cfg = { serverUrl: 'http://127.0.0.1:9', projectRoots: [], sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
      privacy: { mode: 'local-only', includePaths: kind === 'binding' ? ['/allowed'] : [], excludePaths: [] } };
    const plan = (dryRun = true) => planBoundedReplay({ source: 'claude-code', file, from: '2026-10-07T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z', maxBytes: 100_000, maxEvents: 10, dryRun });
    fs.writeFileSync(file, row('one', kind === 'binding' ? '/allowed/project' : root));
    let mergeCalls = 0, executeEntered = false;
    const mergeEvents = () => { mergeCalls++; return { events: [], added: 0 }; };
    if (kind === 'healthy') {
      for (const args of [['init', '-q'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'initial'],
        ['remote', 'add', 'origin', 'https://reader:PRIVATE@git.example/team/fixture.git']]) {
        const setup = cp.spawnSync('git', args, { cwd: root, env: process.env, timeout: 2_000, stdio: 'pipe', maxBuffer: BOUNDS.attributeBytes });
        if (setup.status !== 0) throw Object.assign(new Error('synthetic Git setup did not complete'), { code: 'TW_GIT_SETUP' });
      }
      fs.mkdirSync(join(process.env.HOME, '.tokenizer'));
      const queue = join(process.env.HOME, '.tokenizer/queue.jsonl');
      fs.writeFileSync(queue, JSON.stringify({ source: 'claude-code', sourceEventId: 'retained', occurredAt: '2020-01-01T00:00:00.000Z' }) + '\n');
      const before = sha(fs.readFileSync(queue));
      const preview = measure('preview', () => dryRunBoundedReplay(plan(), cfg), (value) => ({ wouldAdmit: value.wouldAdmit, hasDigest: typeof value.planDigest === 'string' }));
      observations.push({ stage: 'preview-read-only', unchanged: sha(fs.readFileSync(queue)) === before });
      if (preview) { executeEntered = true; measure('execute', () => executeBoundedReplay(plan(false), cfg, preview.planDigest, { readCurrentConfig: () => cfg }), (value) => ({ admitted: value.admitted, backlog: value.backlog })); }
      else unreachable('execute', 'preview-did-not-complete');
      const queueText = fs.readFileSync(queue, 'utf8');
      observations.push({ stage: 'queue', executeEntered, containsCanary: /TW_RAW_CONTENT_CANARY|PRIVATE|reader/.test(queueText), retained: queueText.includes('retained'),
        warmSingleProductProcessNotOriginalColdProbeParity: true });
    } else {
      const preview = measure('preview', () => dryRunBoundedReplay(plan(), cfg), (value) => ({ wouldAdmit: value.wouldAdmit, hasDigest: typeof value.planDigest === 'string' }));
      const stages = [...(kind === 'binding' ? ['bad-digest'] : []), kind === 'binding' ? 'privacy-scope' : 'projectRoots', 'privacy-mode', 'source-content'];
      if (preview) {
        executeEntered = true;
        if (kind === 'binding') measure('bad-digest', () => executeBoundedReplay(plan(false), cfg, '0'.repeat(64), { readCurrentConfig: () => cfg, mergeEvents }));
        for (const [stage, changed] of [[kind === 'binding' ? 'privacy-scope' : 'projectRoots', kind === 'binding' ? { ...cfg, privacy: { ...cfg.privacy, includePaths: ['/different'] } } : { ...cfg, projectRoots: [root] }],
          ['privacy-mode', { ...cfg, privacy: { ...cfg.privacy, mode: 'sync' } }]]) measure(stage, () => executeBoundedReplay(plan(false), cfg, preview.planDigest, { readCurrentConfig: () => changed, mergeEvents }));
        if (kind === 'binding') fs.appendFileSync(file, row('changed', '/allowed/project'));
        measure('source-content', () => executeBoundedReplay(plan(false), cfg, preview.planDigest, { readCurrentConfig: () => { if (kind !== 'binding') fs.writeFileSync(file, row('two')); return cfg; }, mergeEvents }));
      } else for (const stage of stages) unreachable(stage, 'preview-did-not-complete');
      observations.push({ stage: 'merge-count', mergeCalls, executeEntered, zeroDoesNotProveUnreachedNegative: !executeEntered });
    }
  }
  const result = { case: kind, arm: process.env.TW_PARITY_ARM, oldTracePreload: process.env.TW_PARITY_TRACE,
    commonBudgetGuardOn: true, operationBudgetMs: BOUNDS.operationMs, p2Succeeded, observations, releaseAcceptance: false };
  console.log(JSON.stringify(result));
}

if (new URL(import.meta.url).searchParams.get('guard') === '1') installGuard();
else if (process.argv[1] && resolve(process.argv[1]) === self) {
  if (process.platform !== 'win32' || !process.version.startsWith('v22.')) throw new Error('Native Windows Node22 required; no local substitute');
  if (process.argv[2] === '--probe') {
    try { await runProbe(); } catch (error) {
      console.log(JSON.stringify({ case: process.env.TW_PARITY_CASE, arm: process.env.TW_PARITY_ARM, commonBudgetGuardOn: true,
        probeSetupComplete: false, code: /^[A-Z0-9_]{1,64}$/.test(error.code ?? '') ? error.code : 'PROBE_SETUP_ERROR', releaseAcceptance: false }));
      process.exitCode = 1;
    }
  } else {
    assert(process.argv.length === 2, 'no ad-hoc cases or arms');
    try { await runParent(); } catch (error) {
      console.log(JSON.stringify({ diagnosticCompleted: false, diagnosticSetupOrEvidenceFailure: true,
        code: /^[A-Z0-9_]{1,64}$/.test(error.code ?? '') ? error.code : 'DIAGNOSTIC_FAILURE', releaseAcceptance: false }));
      process.exitCode = 1;
    }
  }
}
