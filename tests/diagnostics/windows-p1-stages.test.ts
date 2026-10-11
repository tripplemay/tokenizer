import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as p1 from '../../docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';

type Row = Record<string, any>;
const temporary = process.env.TMPDIR ?? process.env.TEMP;
if (!temporary) throw new Error('owned test temporary base required');
const owned = fs.mkdtempSync(join(temporary, 'wp1-synthetic-'));
afterAll(() => fs.rmSync(owned, { recursive: true, force: true }));
const repo = resolve('.');
const jsonl = (rows: Row[]) => Buffer.from(rows.map(r => JSON.stringify(r) + '\n').join(''));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const scriptBytes = (variant: string, count?: number, newline = '\n') => {
  const c = p1.CASES.find(c => c.variant === variant)!;
  return Buffer.from(c.sequence.slice(0, count ?? c.sequence.length).map(m => p1.BINDINGS.tokens[m] + newline).join(''));
};
function recordStream(variant: string, chunks: Buffer[], eof = true) {
  const events: Row[] = [];
  let time = 0;
  const r = p1.createRecorder(variant, event => events.push(event), () => time++);
  for (const chunk of chunks) r.feed('stdout', chunk);
  if (eof) { r.end('stdout'); r.end('stderr'); }
  const end = r.finish();
  return { events, end, markers: r.markers, recorder: r };
}
function fixture(variant = 'T1', outcome = 'completed', count?: number): any {
  const c = p1.CASES.find(c => c.variant === variant)!;
  const markers = c.sequence.slice(0, count ?? c.sequence.length);
  const status = outcome === 'refused' ? 1 : outcome === 'timeout' ? null : 0;
  const signal = outcome === 'timeout' ? 'SIGKILL' : null;
  const bytes = scriptBytes(variant, markers.length).length;
  const guard: Row[] = [
    { pid: 100, sequence: 0, at: 1, event: 'guard-preload', commonBudgetGuardOn: true, oldTracePreloadOn: true },
    { pid: 200, sequence: 0, at: 1, event: 'guard-preload', commonBudgetGuardOn: true, oldTracePreloadOn: true },
    { pid: 200, sequence: 1, at: 1, event: 'spawn', executable: 'powershell.exe', childPid: 300, detached: false },
    ...markers.map((marker, ordinal) => ({ pid: 200, sequence: 2 + ordinal, at: 1, event: 'native-fixed-stage', childPid: 300,
      variant, marker, ordinal, arrivalElapsedMs: ordinal + 1 })),
    { pid: 200, sequence: 2 + markers.length, at: 1, event: 'child-exit', executable: 'powershell.exe', childPid: 300, status, signal },
    { pid: 200, sequence: 3 + markers.length, at: 1, event: 'native-fixed-stream-end', childPid: 300, variant, stdoutBytes: bytes, stderrBytes: 0,
      combinedBytes: bytes, acceptedMarkers: markers.length, stdoutEofObserved: true, stderrEofObserved: true, eofObserved: true,
      state: markers.length === c.sequence.length ? 'complete-sequence' : 'complete-prefix', reason: 'none' },
    { pid: 200, sequence: 4 + markers.length, at: 1, event: 'child-close', executable: 'powershell.exe', childPid: 300, status, signal },
    { pid: 100, sequence: 1, at: 1, event: 'spawn-sync', executable: 'node', childPid: 200, status: 0, signal: null, code: null }
  ];
  const trace: Row[] = [
    { pid: 100, sequence: 0, at: 1, monotonicMs: 1, event: 'preload', node: 'v22.22.0', uv: '1.51.0' },
    { pid: 200, sequence: 0, at: 1, monotonicMs: 1, event: 'preload', node: 'v22.22.0', uv: '1.51.0' },
    { pid: 200, sequence: 1, at: 1, monotonicMs: 1, event: 'spawn', executable: 'powershell.exe', childPid: 300, detached: false },
    { pid: 200, sequence: 2, at: 1, monotonicMs: 1, event: 'child-exit', executable: 'powershell.exe', childPid: 300, status, signal },
    { pid: 200, sequence: 3, at: 1, monotonicMs: 1, event: 'child-close', executable: 'powershell.exe', childPid: 300, status, signal },
    { pid: 100, sequence: 1, at: 1, monotonicMs: 1, event: 'spawn-sync', executable: 'node', childPid: 200, elapsedMs: 1,
      status: 0, signal: null, code: null, workerKind: outcome === 'timeout' ? 'timeout' : 'ok' }
  ];
  const native = { outcome, metadataSource: outcome === 'timeout' ? 'api-throw' : 'api-return', status: outcome === 'timeout' ? null : status,
    signal: null, errorName: outcome === 'timeout' ? 'BoundedSubprocessTimeoutError' : null, errorCode: null,
    elapsedMs: 1, workerKind: outcome === 'timeout' ? 'timeout' : 'ok' };
  return { variant, guard, trace, launches: 1, counterKnown: true,
    probe: { format: 'windows-p1-initial-probe-v1', variant, caseId: c.caseId, scriptSha256: c.scriptSha256,
      probeSetupComplete: true, native, releaseAcceptance: false },
    root: { pid: 100, status: 0, signal: null, metadataUnknown: false, stopped: false, stopReason: null, launchCode: null,
      stdoutBytes: 256, stderrBytes: 0, outputBoundExceeded: false, canaryFound: false },
    health: { expectedPids: [100, 200], guardComplete: true, traceComplete: true, guardInvalid: false, traceInvalid: false,
      diagnosticAbortReasons: [], provenanceUnknown: false, cleanupUnknown: false, possibleLiveAtReturn: [], possibleLiveAfterOwnedCap: [],
      rootRetained: false, historicalPidsSignalled: false, wholeTreeAbsenceProven: false } };
}
const directory = () => fs.mkdtempSync(join(owned, 'case-'));
const io = () => Object.fromEntries(['mkdirSync', 'rmdirSync', 'lstatSync', 'fstatSync', 'openSync', 'readFileSync', 'readSync',
  'writeSync', 'writeFileSync', 'closeSync', 'appendFileSync', 'realpathSync', 'readdirSync', 'rmSync'].map(k => [k, (fs as any)[k].bind(fs)]));
const admitted = () => ({ event: 'powershell-admission', kind: 'smoke' });

describe('all-token-chunk-splits-and-LF-CRLF', () => {
  it('accepts every split of every complete fixed sequence and byte-at-a-time coalescing', () => {
    for (const c of p1.CASES) for (const newline of ['\n', '\r\n']) {
      const bytes = scriptBytes(c.variant, undefined, newline);
      for (let split = 0; split <= bytes.length; split++) {
        const r = recordStream(c.variant, [bytes.subarray(0, split), bytes.subarray(split)]);
        expect(r.markers).toEqual(c.sequence); expect(r.end?.state).toBe('complete-sequence');
      }
      expect(recordStream(c.variant, [...bytes].map(b => Buffer.from([b]))).markers).toEqual(c.sequence);
    }
  });
  it('keeps arrival ordinals monotonic, enum-only and within the fixed lifetime', () => {
    const r = recordStream('T3', [scriptBytes('T3')]);
    expect(r.events.filter(e => e.event === 'native-fixed-stage').map(e => e.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(JSON.stringify(r.events)).not.toContain('TW_P1_STAGE');
    expect(r.events.every(e => e.arrivalElapsedMs === undefined || e.arrivalElapsedMs <= 40000)).toBe(true);
  });
});

describe('timeout-prefix-immediate-safe-persistence', () => {
  it('persists a prefix synchronously before a mock worker timeout discards stdout', () => {
    const stored: Row[] = [];
    const r = p1.createRecorder('T2', event => stored.push(event), () => 1);
    r.feed('stdout', scriptBytes('T2', 1));
    expect(stored.map(e => e.marker)).toEqual(['json-enter']);
    const mockWorkerResult = { kind: 'timeout' };
    expect(mockWorkerResult).not.toHaveProperty('stdout');
    r.end('stdout'); r.end('stderr'); r.finish();
    expect(stored.at(-1)?.state).toBe('complete-prefix');
    expect(p1.evaluateCase(fixture('T2', 'timeout', 1)).native_completed).toBe(false);
  });
  it('does not duplicate stream-end at close and safe finalization', () => {
    const r = recordStream('T0', [scriptBytes('T0')]);
    expect(r.recorder.finish()).toBeNull();
    expect(r.events.filter(e => e.event === 'native-fixed-stream-end')).toHaveLength(1);
  });
});

describe('missing-EOF-event-health-or-stream-error', () => {
  it.each(['stdout', 'stderr'])('requires actual %s end rather than close or destroy', missing => {
    const stored: Row[] = [];
    const r = p1.createRecorder('T0', e => stored.push(e), () => 1);
    r.feed('stdout', scriptBytes('T0')); r.end(missing === 'stdout' ? 'stderr' : 'stdout');
    expect(r.finish()?.state).toBe('unknown'); expect(stored.at(-1)?.reason).toBe('eof-not-observed');
  });
  it('preserves stream errors even with complete markers and both EOFs', () => {
    const r = recordStream('T0', [scriptBytes('T0')], false); r.recorder.error();
    // Finish was already emitted; a fresh error-bearing stream models the pre-close boundary.
    const x = p1.createRecorder('T0', () => {}, () => 1);
    x.feed('stdout', scriptBytes('T0')); x.error(); x.end('stdout'); x.end('stderr');
    expect(x.finish()?.reason).toBe('stream-error');
  });
  it('missing stream-end and either health stream block progression independently', () => {
    for (const mutate of [
      (f: any) => { f.guard = f.guard.filter((r: Row) => r.event !== 'native-fixed-stream-end'); },
      (f: any) => { f.health.guardComplete = false; }, (f: any) => { f.health.traceComplete = false; },
      (f: any) => { f.health.expectedPids = []; }
    ]) {
      const f = fixture('T1', 'timeout', 0); mutate(f);
      const r = p1.evaluateCase(f); expect(r.diagnostic_observation_complete).toBe(false); expect(p1.selection(r).action).toBe('stop-unknown');
    }
  });
});

describe('unsafe-bytes-canaries-stderr-and-order', () => {
  it.each(['\uFEFF', '\n', ' ', 'RAW-STDERR-CANARY', 'TW_RAW_CONTENT_CANARY', 'PRIVATE-reader', '\u00e9', '\0', '\r'])('rejects unsafe literal %j without a raw fallback', value => {
    const r = recordStream('T2', [Buffer.from(value)]);
    expect(['invalid', 'unknown']).toContain(r.end?.state);
    expect(JSON.stringify(r.events)).not.toContain('CANARY'); expect(r.markers).toEqual([]);
  });
  it('rejects unterminated, duplicate, reordered and wrong-variant tokens', () => {
    expect(recordStream('T0', [Buffer.from(p1.BINDINGS.tokens['writer-ok'])]).end?.reason).toBe('unterminated-line');
    for (const bytes of [scriptBytes('T0'), Buffer.from(p1.BINDINGS.tokens['json-done'] + '\n'), scriptBytes('T3', 1)])
      expect(recordStream('T2', [bytes]).end?.state).toBe('invalid');
    expect(recordStream('T0', [Buffer.concat([scriptBytes('T0'), scriptBytes('T0')])]).end?.reason).toBe('order-or-duplicate');
  });
  it('counts all rejected bytes and stderr, stops accepting later markers and retains the first violation', () => {
    const events: Row[] = [], r = p1.createRecorder('T0', e => events.push(e), () => 1);
    r.feed('stdout', Buffer.from('\n')); r.feed('stdout', scriptBytes('T0')); r.feed('stderr', Buffer.from('x'));
    r.end('stdout'); r.end('stderr'); const end = r.finish();
    expect(r.markers).toEqual([]); expect(end?.combinedBytes).toBe(scriptBytes('T0').length + 2); expect(end?.stderrBytes).toBe(1);
    expect(end?.reason).toBe('unexpected-bytes');
    expect(events.every(e => !Object.hasOwn(e, 'stdout') && !Object.hasOwn(e, 'stderr'))).toBe(true);
  });
  it('rejects non-Buffer chunks and oversized pending lines without unbounded accumulation', () => {
    const r = p1.createRecorder('T0', () => {}, () => 1);
    r.feed('stdout', 'not-a-Buffer' as any); r.end('stdout'); r.end('stderr'); expect(r.finish()?.state).toBe('unknown');
    expect(recordStream('T0', [Buffer.alloc(30, 65)]).end?.state).toBe('invalid');
  });
});

describe('handle-pid-case-script-identity', () => {
  function context(variant = 'T2'): any {
    const c = p1.CASES.find(c => c.variant === variant)!;
    const root = join(owned, c.caseId), args = [...p1.BINDINGS.native.argv_prefix, c.script];
    return { root, command: 'powershell.exe', args, options: { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: false, shell: false },
      argv: [process.execPath, join(repo, 'src/cli/bounded-subprocess-worker.mjs'), JSON.stringify({ command: 'powershell.exe', args,
        timeoutMs: 7000, maxOutputBytes: 16384, cwd: root, cleanupMs: 1000 })], childPid: 300 };
  }
  it('matches only exact worker/script/case/options/positive owned PID', () => {
    expect(p1.matchNativeIdentity(context())?.variant).toBe('T2');
    for (const mutate of [
      (c: any) => { c.command = 'node'; }, (c: any) => { c.root += '-other'; }, (c: any) => { c.args[4] += ' '; },
      (c: any) => { c.argv[1] = join(repo, 'other.mjs'); }, (c: any) => { c.childPid = 0; },
      (c: any) => { c.options.shell = true; }, (c: any) => { c.options.windowsHide = false; },
      (c: any) => { const p = JSON.parse(c.argv[2]); p.timeoutMs = 7001; c.argv[2] = JSON.stringify(p); },
      (c: any) => { const p = JSON.parse(c.argv[2]); p.extra = true; c.argv[2] = JSON.stringify(p); }
    ]) { const c = context(); mutate(c); expect(p1.matchNativeIdentity(c)).toBeNull(); }
  });
  it('attaches additive Buffer listeners before returning without touching existing listeners or worker stdout', () => {
    const child: any = new EventEmitter(); child.pid = 300; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const existing = vi.fn(); child.stdout.on('data', existing);
    const persisted: Row[] = [], observer = p1.attachNativeRecorder(child, context(), e => persisted.push(e), () => 1);
    expect(observer).not.toBeNull(); expect(child.stdout.listeners('data')).toContain(existing);
    const chunk = scriptBytes('T2', 1); child.stdout.emit('data', chunk);
    expect(existing).toHaveBeenCalledWith(chunk); expect(persisted[0]?.marker).toBe('json-enter');
    child.stdout.emit('end'); child.stderr.emit('end'); child.emit('close', null, 'SIGKILL');
    expect(persisted.at(-1)?.eofObserved).toBe(true);
    expect(child.stdout).not.toHaveProperty('setEncoding'); expect(child.stdout).not.toHaveProperty('read');
    const wrong: any = new EventEmitter(); wrong.pid = 0; wrong.stdout = new EventEmitter(); wrong.stderr = new EventEmitter();
    expect(p1.attachNativeRecorder(wrong, context(), () => {})).toBeNull(); expect(wrong.stdout.listenerCount('data')).toBe(0);
  });
});

describe('all-inclusive-caps-and-plus-one', () => {
  it('uses native combined overflow sentinel and independent saturated counts including rejected bytes', () => {
    for (const length of [16384, 16385, 32768]) {
      const events: Row[] = [], r = p1.createRecorder('T0', e => events.push(e), () => 1);
      r.feed('stdout', Buffer.alloc(length, 65)); r.feed('stderr', Buffer.alloc(0)); r.end('stdout'); r.end('stderr');
      const end = r.finish(); expect(end?.stdoutBytes).toBe(16384); expect(end?.combinedBytes).toBe(Math.min(length, 16385));
      expect(end?.reason).toBe(length === 16384 ? 'unexpected-bytes' : 'native-output-cap');
    }
    const r = p1.createRecorder('T0', () => {}, () => 1);
    r.feed('stdout', Buffer.alloc(8192)); r.feed('stderr', Buffer.alloc(8193)); r.end('stdout'); r.end('stderr');
    expect(r.finish()).toMatchObject({ stdoutBytes: 8192, stderrBytes: 8193, combinedBytes: 16385, reason: 'native-output-cap' });
  });
  it('keeps exact root/native inclusive count and +1 semantics', () => {
    for (const cap of [16384, 65536]) {
      let counts = p1.countBytes({ stdoutBytes: 0, stderrBytes: 0, combinedBytes: 0 }, 'stdout', cap - 1, cap);
      counts = p1.countBytes(counts, 'stderr', 1, cap); expect(counts.combinedBytes).toBe(cap);
      counts = p1.countBytes(counts, 'stderr', 1, cap); expect(counts.combinedBytes).toBe(cap + 1);
    }
  });
  it.each(['guard', 'trace', 'counter'])('checks exact %s read cap and cap+1, rather than a pre-append size check', family => {
    const row = family === 'counter' ? admitted() : fixture().guard[0];
    const bytes = jsonl([family === 'trace' ? fixture().trace[0] : row]);
    expect(p1.parseRows(bytes, family, bytes.length).invalid).toBe(false);
    expect(p1.parseRows(bytes, family, bytes.length - 1).invalid).toBe(true);
  });
  it('allows exact aggregate append size and refuses a candidate crossing it', () => {
    const dir = directory(), file = join(dir, 'guard.jsonl'); fs.writeFileSync(file, '');
    const a = fixture().guard[0], b = { ...a, sequence: 1 };
    const bytes = jsonl([a, b]), gate = p1.createAppendGate([{ path: file, cap: bytes.length, family: 'guard' }]);
    gate.append(file, jsonl([a])); gate.append(file, jsonl([b])); expect(fs.statSync(file).size).toBe(bytes.length);
    expect(() => gate.append(file, jsonl([{ ...b, sequence: 2 }]))).toThrow(); expect(fs.statSync(file).size).toBe(bytes.length);
    expect(() => gate.append(join(dir, 'other.jsonl'), 'x')).toThrow();
  });
  it.each(['guard', 'trace'])('enforces the actual 524288-byte %s cap with canonical rows', family => {
    const cap = 524288, rows: Row[] = [];
    let bytes = 0;
    for (let sequence = 0; ; sequence++) {
      const row = family === 'guard' ? { ...fixture().guard[0], sequence, at: 0 } : { ...fixture().trace[0], sequence, at: 0 };
      const length = jsonl([row]).length;
      if (bytes + length > cap) break;
      rows.push(row); bytes += length;
    }
    let remainder = cap - bytes;
    for (const row of rows) {
      if (!remainder) break;
      const delta = Math.min(remainder, 15); row.at = Number('1'.repeat(delta + 1)); remainder -= delta;
    }
    const input = jsonl(rows); expect(input.length).toBe(cap); expect(remainder).toBe(0);
    const dir = directory(), file = join(dir, family + '.jsonl'); fs.writeFileSync(file, '');
    const gate = p1.createAppendGate([{ path: file, cap, family }]); gate.append(file, input); expect(fs.statSync(file).size).toBe(cap);
    expect(p1.parseRows(input, family).invalid).toBe(false);
    expect(p1.parseRows(Buffer.concat([input, Buffer.from('x')]), family).invalid).toBe(true);
    expect(() => gate.append(file, jsonl([{ ...rows[0], sequence: rows.length }]))).toThrow();
  });
});

describe('concurrent-append-and-lock-failure', () => {
  it('atomic mkdir contention aborts once, does not wait/retry and does not remove another writer lock', () => {
    const dir = directory(), file = join(dir, 'guard.jsonl'); fs.writeFileSync(file, '');
    const methods = io(), mkdir = vi.fn(methods.mkdirSync); methods.mkdirSync = mkdir;
    const fail = vi.fn(), gate = p1.createAppendGate([{ path: file, cap: 524288, family: 'guard' }], methods, fail);
    fs.mkdirSync(file + '.append-lock');
    expect(() => gate.append(file, jsonl([fixture().guard[0]]))).toThrow();
    expect(mkdir).toHaveBeenCalledTimes(1); expect(fail).toHaveBeenCalledTimes(1); expect(fs.existsSync(file + '.append-lock')).toBe(true);
    expect(fs.statSync(file).size).toBe(0);
  });
  it('reentrant aggregate writer cannot slip past the held lock', () => {
    const dir = directory(), file = join(dir, 'guard.jsonl'); fs.writeFileSync(file, '');
    const methods = io(), write = methods.writeSync; let attempted = false; let nested: unknown;
    const gate = p1.createAppendGate([{ path: file, cap: 524288, family: 'guard' }], methods);
    methods.writeSync = (...args: any[]) => {
      if (!attempted) { attempted = true; try { gate.append(file, jsonl([fixture().guard[0]])); } catch (e) { nested = e; } }
      return write(...args);
    };
    gate.append(file, jsonl([fixture().guard[0]])); expect(nested).toBeInstanceOf(Error); expect(p1.parseRows(fs.readFileSync(file), 'guard').rows).toHaveLength(1);
  });
  it.each(['partial', 'release', 'identity', 'symlink', 'read'])('fails closed on %s evidence IO with no retry', fault => {
    const dir = directory(), file = join(dir, 'guard.jsonl'); fs.writeFileSync(file, ''); const methods = io();
    const fail = vi.fn(), gate = p1.createAppendGate([{ path: file, cap: 524288, family: 'guard' }], methods, fail);
    if (fault === 'partial') methods.writeSync = () => 1;
    if (fault === 'release') methods.rmdirSync = () => { throw new Error('mock release failure'); };
    if (fault === 'read') methods.readSync = () => { throw new Error('mock read failure'); };
    if (fault === 'identity') { fs.renameSync(file, file + '.original'); fs.writeFileSync(file, ''); }
    if (fault === 'symlink') {
      const lstat = methods.lstatSync;
      methods.lstatSync = (path: string) => { const s = lstat(path); if (path === file) s.isSymbolicLink = () => true; return s; };
    }
    expect(() => gate.append(file, jsonl([fixture().guard[0]]))).toThrow(); expect(fail).toHaveBeenCalledTimes(1);
  });
  it('keeps counter parsing, limits and append inside the same exact-path transaction', () => {
    const dir = directory(), file = join(dir, 'counter.jsonl'); fs.writeFileSync(file, '');
    const gate = p1.createAppendGate([{ path: file, cap: 16384, family: 'counter' }]);
    gate.transaction(file, bytes => { expect(fs.existsSync(file + '.append-lock')).toBe(true); expect(p1.counterState(bytes).total).toBe(0); return jsonl([admitted()]); });
    expect(p1.counterState(fs.readFileSync(file)).total).toBe(1);
    expect(() => gate.append(file, jsonl([admitted()]))).toThrow();
  });
  it('old trace captures the installed exact-path append gate while unrelated targets remain untouched', () => {
    const dir = directory(), file = join(dir, 'trace.jsonl'); fs.writeFileSync(file, '');
    const row = jsonl([fixture().trace[0]]), gate = p1.createAppendGate([{ path: file, cap: row.length, family: 'trace' }]);
    const unrelated = vi.fn(), filesystem = { appendFileSync: unrelated }, sync = vi.fn();
    p1.installAppendWrapper(filesystem, gate, sync); expect(sync).toHaveBeenCalledOnce();
    const oldTraceCaptured = filesystem.appendFileSync;
    oldTraceCaptured(file, row); expect(fs.statSync(file).size).toBe(row.length);
    expect(() => oldTraceCaptured(file, row)).toThrow();
    oldTraceCaptured(join(dir, 'other.jsonl'), 'untouched'); expect(unrelated).toHaveBeenCalledOnce();
  });
});

describe('counter-and-clock-admission-boundaries', () => {
  it('requires 43000ms case and 10000ms native remaining, exact 7000ms child budget and no unknown clock', () => {
    expect(p1.caseAdmission({ now: 1, deadline: 43001, usedTotal: 0, usedSmoke: 0 })).toBe(true);
    expect(p1.caseAdmission({ now: 1, deadline: 43000, usedTotal: 0, usedSmoke: 0 })).toBe(false);
    for (const now of [NaN, Infinity, -1, 0.5]) expect(p1.caseAdmission({ now, deadline: 999999, usedTotal: 0, usedSmoke: 0 })).toBe(false);
    expect(p1.nativeAdmission({ now: 1, deadline: 10001, timeoutMs: 7000, usedTotal: 0, usedSmoke: 0 })).toBeNull();
    expect(p1.nativeAdmission({ now: 1, deadline: 10000, timeoutMs: 7000, usedTotal: 0, usedSmoke: 0 })).toBe('native-cleanup-output-allowance-insufficient');
    for (const timeoutMs of [0, 6999, 7001, NaN]) expect(p1.nativeAdmission({ now: 1, deadline: 10001, timeoutMs, usedTotal: 0, usedSmoke: 0 })).toBe('unknown-native-budget');
    expect(p1.caseAdmission({ now: 1, deadline: 600002, usedTotal: 0, usedSmoke: 0 })).toBe(false);
    expect(p1.nativeAdmission({ now: 1, deadline: 40002, timeoutMs: 7000, usedTotal: 0, usedSmoke: 0 })).toBe('unknown-native-budget');
  });
  it('preserves 38/76 frozen counters, four INITIAL admissions and rejects corrupt/missing/oversized rows', () => {
    expect(p1.counterState(jsonl(Array.from({ length: 38 }, admitted))).total).toBe(38);
    expect(() => p1.counterState(jsonl(Array.from({ length: 39 }, admitted)))).toThrow();
    for (const bytes of [Buffer.from('{}\n'), Buffer.from('\n'), Buffer.from(''), Buffer.alloc(16385)]) {
      if (!bytes.length) expect(p1.counterState(bytes).total).toBe(0); else expect(() => p1.counterState(bytes)).toThrow();
    }
    for (const usedTotal of [4, 38, 76, 77]) expect(p1.caseAdmission({ now: 1, deadline: 43001, usedTotal, usedSmoke: Math.min(usedTotal, 38) })).toBe(false);
    expect(p1.caseAdmission({ now: 1, deadline: 43001, usedTotal: 3, usedSmoke: 3 })).toBe(true);
    expect(p1.nativeAdmission({ now: 1, deadline: 10001, timeoutMs: 7000, usedTotal: 76, usedSmoke: 38 })).not.toBeNull();
  });
});

describe('cleanup-trace-provenance-independent-unknown', () => {
  it.each(['cleanupUnknown', 'provenanceUnknown', 'guardInvalid', 'traceInvalid', 'rootRetained'])('a %s flag cannot be overridden by a complete terminal', field => {
    const f = fixture('T1'); f.health[field] = true;
    const r = p1.evaluateCase(f); expect(r.diagnostic_observation_complete).toBe(false); expect(p1.selection(r).action).toBe('stop-unknown');
    expect(r.health?.[field]).toBe(true); expect(r.health?.wholeTreeAbsenceProven).toBe(false);
  });
  it('forced roots, canaries, stderr, possible-live samples and unknown counters independently block', () => {
    for (const mutate of [
      (f: any) => { f.root.stopped = true; f.root.stopReason = 'owned-case-watchdog-expired'; },
      (f: any) => { f.root.metadataUnknown = true; }, (f: any) => { f.root.canaryFound = true; },
      (f: any) => { f.root.stderrBytes = 1; }, (f: any) => { f.health.possibleLiveAfterOwnedCap = [300]; },
      (f: any) => { f.counterKnown = false; }, (f: any) => { f.launches = null; }
    ]) { const f = fixture(); mutate(f); expect(p1.evaluateCase(f).diagnostic_observation_complete).toBe(false); }
  });
});

describe('every-selection-row-zero-skipped-launches', () => {
  it('uses conservative T0/T1/T2 stop/continue rows and terminal T3 once', () => {
    expect(p1.selection(p1.evaluateCase(fixture('T0'))).action).toBe('run-T1');
    expect(p1.selection(p1.evaluateCase(fixture('T0', 'timeout', 0))).action).toBe('stop-unknown');
    expect(p1.selection(p1.evaluateCase(fixture('T1')))).toEqual({ action: 'stop', reason: 'original-p1-complete-no-reproduction' });
    for (const outcome of ['timeout', 'refused']) {
      expect(p1.selection(p1.evaluateCase(fixture('T1', outcome, 0))).action).toBe('run-T2');
      expect(p1.selection(p1.evaluateCase(fixture('T2', outcome, 1))).action).toBe('run-T3');
      for (const count of [0, 2]) expect(p1.selection(p1.evaluateCase(fixture('T2', outcome, count))).action).toBe('stop-unknown');
    }
    expect(p1.selection(p1.evaluateCase(fixture('T2'))).reason).toBe('direct-invoke-complete-no-refinement');
    expect(p1.selection(p1.unknownCase('T3')).action).toBe('stop');
  });
  it('never launches a skipped case and never fabricates zero/start=false for a missing outcome', () => {
    for (const c of p1.CASES) {
      const skip = p1.skippedCase(c.variant, 'budget-admission-denied');
      expect(skip.rootProcessStarted).toBe(false); expect(skip.nativeLaunches).toBe(0); expect(skip.root).toBeNull();
      const unknown = p1.unknownCase(c.variant); expect(unknown.rootProcessStarted).toBeNull(); expect(unknown.nativeLaunches).toBeNull();
    }
    const t0 = p1.evaluateCase(fixture('T0')), t1 = p1.evaluateCase(fixture('T1'));
    expect(p1.validateSequence([t0, t1, p1.skippedCase('T2', 'original-p1-complete-no-reproduction'), p1.skippedCase('T3', 'original-p1-complete-no-reproduction')])).toBe(true);
    expect(p1.validateSequence([t0, t1, p1.evaluateCase(fixture('T2')), p1.unknownCase('T3')])).toBe(false);
  });
  it('retains safe unknown root-launch metadata without inventing a root PID or a native return', () => {
    const f = fixture('T0'); f.root.pid = null; f.root.status = null; f.root.metadataUnknown = true; f.root.launchCode = 'ENOENT';
    f.guard = []; f.trace = []; f.launches = 0; f.probe = null; f.health.expectedPids = [];
    f.health.guardComplete = f.health.traceComplete = false;
    const r = p1.evaluateCase(f); expect(r.rootProcessStarted).toBeNull(); expect(r.native.outcome).toBe('unknown');
    expect(r.health?.rootRetained).toBe(true); expect(p1.validateCaseRecord(r, [], [], true)).toBe(true);
    const records = [r, ...p1.CASES.slice(1).map(c => p1.skippedCase(c.variant, 'writer-control-not-complete'))];
    expect(p1.makeSummary({ executionSha: 'a'.repeat(40) }, records, [], 1, 'writer-control-not-complete', true).totalNativeLaunches).toBeNull();
  });
});

describe('strict-extra-key-rejection', () => {
  it('rejects every closed schema extra key and malformed raw event/line before rebuilding', () => {
    const f = fixture(), r = p1.evaluateCase(f);
    for (const [name, value] of [['native', f.probe.native], ['probe', f.probe], ['root', f.root], ['health', f.health], ['caseRecord', r],
      ['stage', f.guard.find((e: Row) => e.event === 'native-fixed-stage')], ['streamEnd', f.guard.find((e: Row) => e.event === 'native-fixed-stream-end')]])
      expect(p1.rebuild(name as string, { ...(value as Row), raw: 'CANARY' })).toBeNull();
    for (const text of ['{}\n', JSON.stringify(f.guard[0]) + '\n\n', '\uFEFF' + JSON.stringify(f.guard[0]) + '\n', JSON.stringify(f.guard[0]),
      JSON.stringify({ ...f.guard[0], extra: true }) + '\n', '{"event":"powershell-admission","event":"powershell-admission","kind":"smoke"}\n'])
      expect(p1.parseRows(Buffer.from(text), 'guard').invalid).toBe(true);
    expect(p1.parseRows(Buffer.from([0xff, 10]), 'guard').invalid).toBe(true);
  });
  it('validates all case cross fields and rejects a terminal-only invented success', () => {
    const f = fixture('T2'), r = p1.evaluateCase(f);
    expect(p1.validateCaseRecord(r, f.guard, f.trace, true)).toBe(true);
    for (const mutate of [(r: any) => { r.caseId = p1.CASES[0].caseId; }, (r: any) => { r.markers = ['terminal-json']; },
      (r: any) => { r.notObserved = ['json-enter']; }, (r: any) => { r.nativeLaunches = 0; }, (r: any) => { r.stream.eofObserved = false; }]) {
      const candidate = clone(r); mutate(candidate); expect(p1.validateCaseRecord(candidate, f.guard, f.trace, true)).toBe(false);
    }
  });
  it('requires one canonical root object with no BOM, duplicate key, extra object or raw canary', () => {
    const probe = fixture().probe, text = JSON.stringify(probe) + '\n';
    expect(p1.parseProbeBytes(Buffer.from(text))).toEqual(probe);
    for (const candidate of ['\uFEFF' + text, text + text, text.replace('"releaseAcceptance":false', '"releaseAcceptance":true,"releaseAcceptance":false'),
      text.replace('"format":', '"raw":"RAW-STDERR-CANARY","format":'), text.replace('"format":', '"extra":true,"format":'), text.trimEnd()])
      expect(p1.parseProbeBytes(Buffer.from(candidate))).toBeNull();
  });
});

describe('import-without-side-effects', () => {
  it('a fresh test import performs no spawn, append, mkdir, guard installation or diagnostic main', async () => {
    const spawn = vi.spyOn(cp, 'spawn'), sync = vi.spyOn(cp, 'spawnSync'), append = vi.spyOn(fs, 'appendFileSync'), mkdir = vi.spyOn(fs, 'mkdirSync');
    try {
      const url = pathToFileURL(join(repo, 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs')); url.searchParams.set('synthetic-import', '1');
      const m = await import(/* @vite-ignore */ url.href);
      expect(m.CASES).toHaveLength(4); expect(spawn).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled();
      expect(append).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
    } finally { spawn.mockRestore(); sync.mockRestore(); append.mockRestore(); mkdir.mockRestore(); }
  });
});

describe('exact-source-workflow-and-upload-file-set', () => {
  function sealed(): any {
    const dir = directory(), executionSha = 'a'.repeat(40);
    const files = [...p1.BINDINGS.future_added_source_paths, 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json',
      ...p1.BINDINGS.frozen_runtime_sources.map(s => s.path)].sort().map(path => ({ path, sha256: p1.sha256(fs.readFileSync(join(repo, path))) }));
    const provenance = { format: 'windows-p1-initial-provenance-v1', executionSha, expectedSha: executionSha,
      planningBase: p1.BINDINGS.planning_base, timestampUtc: '2026-10-11T00:00:00Z', runId: '1', runAttempt: 1,
      ref: 'refs/heads/codex/windows-p1-stages-ci-20261010', runtime: { node: 'v22.22.0', uv: '1.51.0', platform: 'win32', arch: 'x64',
        osRelease: '10.0.1', imageOS: 'win25', imageVersion: '20261011.1.0' }, sourceFiles: clone(files),
      environmentKeyNames: [...p1.BINDINGS.environment.system_keys, ...p1.BINDINGS.environment.synthetic_keys].sort(),
      extraEnvironmentKeys: [], provenanceUnknown: false, releaseReady: false, releaseAcceptance: false };
    const first = fixture('T0'), second = fixture('T1'), records = [p1.evaluateCase(first), p1.evaluateCase(second),
      p1.skippedCase('T2', 'original-p1-complete-no-reproduction'), p1.skippedCase('T3', 'original-p1-complete-no-reproduction')];
    const summary = p1.makeSummary(provenance, records, [admitted(), admitted()], 0, 'original-p1-complete-no-reproduction', true);
    const checks = { format: 'windows-p1-initial-checks-v1', testPath: 'tests/diagnostics/windows-p1-stages.test.ts', exitCode: 0, passed: 14,
      failed: 0, skipped: 0, allRequiredControlsPassed: true, rawReportSuppressed: true, releaseAcceptance: false };
    fs.writeFileSync(join(dir, 'provenance.json'), JSON.stringify(provenance)); fs.writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary));
    fs.writeFileSync(join(dir, 'checks-summary.json'), JSON.stringify(checks));
    for (const r of records) fs.writeFileSync(join(dir, r.variant + '.case.json'), JSON.stringify(r));
    for (const c of p1.CASES) for (const family of ['guard', 'trace'])
      fs.writeFileSync(join(dir, c.variant + '.' + family + '.jsonl'), c.variant === 'T0' ? jsonl(first[family]) : c.variant === 'T1' ? jsonl(second[family]) : '');
    const rehash = () => {
      const entries = p1.BINDINGS.output.upload_files.filter(p => p !== 'manifest.json').sort().map(path => {
        const bytes = fs.readFileSync(join(dir, path)); return { path, bytes: bytes.length, sha256: p1.sha256(bytes) };
      });
      fs.writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ format: 'windows-p1-initial-manifest-v1', executionSha, files: entries, releaseAcceptance: false }));
    };
    rehash(); return { dir, files, executionSha, provenance, summary, rehash };
  }
  it('locks original hashes, four scripts and E0 environment with no repairs or extra selector', () => {
    expect(p1.validateBindings()).toBe(true);
    expect(p1.CASES.map(c => p1.sha256(c.script))).toEqual(p1.CASES.map(c => c.scriptSha256));
    expect(p1.systemEnvironment({ Path: 'owned-path', APPDATA: 'forbidden', SystemDrive: 'forbidden' })).toEqual({ PATH: 'owned-path' });
    expect(() => p1.systemEnvironment({ Path: 'a', PATH: 'b' })).toThrow();
    expect(p1.BINDINGS.environment.extra_keys).toEqual([]);
  });
  it('uses only the locked job/ref/commands and 16 explicit upload paths, not dispatch, secrets or globs', () => {
    const text = fs.readFileSync(join(repo, p1.BINDINGS.workflow.path), 'utf8');
    expect(text).toContain("if: " + p1.BINDINGS.workflow.job_if); expect(text).toContain('cancel-in-progress: false');
    expect(text).toContain('timeout-minutes: 12'); expect(text).toContain('persist-credentials: false'); expect(text).toContain('ref: ${{ github.sha }}');
    expect(text).not.toMatch(/workflow_dispatch|pull_request|schedule:|secrets\.|environment:|powershell\.exe|continue-on-error/);
    expect(text.match(/^        run: (.*)$/gm)?.map(line => line.slice(13))).toEqual(p1.BINDINGS.workflow.ordered_commands);
    expect(text.match(/^            docs\/.*$/gm)?.map(line => line.trim())).toEqual(p1.BINDINGS.output.upload_files.map(p => p1.BINDINGS.output.upload_root + p));
    expect(text).not.toMatch(/upload\/\*|path:.*scratch/); expect(p1.BINDINGS.output.manifest_entries).toBe(15);
  });
  it('requires every declared control and rejects absent, skipped, wrong-scope and inconsistent test reports', () => {
    const assertions = p1.BINDINGS.required_future_controls.map(id => ({ fullName: id + ' mock-control', status: 'passed' }));
    const raw: any = { success: true, numPassedTests: assertions.length, numFailedTests: 0, numPendingTests: 0, numTotalTests: assertions.length,
      testResults: [{ name: '/owned/tests/diagnostics/windows-p1-stages.test.ts', status: 'passed', assertionResults: assertions }] };
    expect(p1.checksSummary(raw)?.allRequiredControlsPassed).toBe(true); expect(p1.checksSummary(null)).toBeNull();
    const skipped = clone(raw); skipped.testResults[0].assertionResults[0].status = 'pending'; skipped.numPassedTests--; skipped.numPendingTests++;
    expect(p1.checksSummary(skipped)?.allRequiredControlsPassed).toBe(false);
    const missing = clone(raw); missing.testResults[0].assertionResults[0].fullName = 'not-the-required-control';
    expect(p1.checksSummary(missing)?.allRequiredControlsPassed).toBe(false);
    const wrong = clone(raw); wrong.testResults[0].name = '/owned/tests/unrelated.test.ts'; expect(p1.checksSummary(wrong)).toBeNull();
  });
  it('verifies all 16 owned sealed files and 15 digest entries, rejects extras, altered bytes and alias roots', () => {
    const s = sealed(); expect(p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toBe(true);
    fs.writeFileSync(join(s.dir, 'raw.log'), 'not public'); expect(() => p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toThrow(); fs.unlinkSync(join(s.dir, 'raw.log'));
    fs.appendFileSync(join(s.dir, 'T0.guard.jsonl'), ' '); expect(() => p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toThrow();
    const clean = sealed(), alias = join(owned, 'alias-' + Date.now()); fs.symlinkSync(clean.dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => p1.verifySealedDirectory(alias, clean.files, clean.executionSha)).toThrow();
  });
  it('rejects malformed core/provenance, changed candidate hashes, unsafe public evidence and manifest laundering', () => {
    for (const mutate of [
      (s: any) => { s.provenance.expectedSha = 'b'.repeat(40); fs.writeFileSync(join(s.dir, 'provenance.json'), JSON.stringify(s.provenance)); },
      (s: any) => { s.provenance.sourceFiles[0].sha256 = 'b'.repeat(64); fs.writeFileSync(join(s.dir, 'provenance.json'), JSON.stringify(s.provenance)); },
      (s: any) => { s.provenance.environmentKeyNames.push('APPDATA'); fs.writeFileSync(join(s.dir, 'provenance.json'), JSON.stringify(s.provenance)); },
      (s: any) => { fs.writeFileSync(join(s.dir, 'T0.guard.jsonl'), 'RAW-STDERR-CANARY\n'); },
      (s: any) => { fs.writeFileSync(join(s.dir, 'T0.case.json'), '{"unsafe":true}'); },
      (s: any) => { const c = JSON.parse(fs.readFileSync(join(s.dir, 'checks-summary.json'), 'utf8')); c.passed = null; fs.writeFileSync(join(s.dir, 'checks-summary.json'), JSON.stringify(c)); },
      (s: any) => { s.summary.totalNativeLaunches = 0; fs.writeFileSync(join(s.dir, 'summary.json'), JSON.stringify(s.summary)); }
    ]) { const s = sealed(); mutate(s); s.rehash(); expect(() => p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toThrow(); }
    const s = sealed(), manifest = JSON.parse(fs.readFileSync(join(s.dir, 'manifest.json'), 'utf8')); manifest.files[1] = manifest.files[0];
    fs.writeFileSync(join(s.dir, 'manifest.json'), JSON.stringify(manifest)); expect(() => p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toThrow();
  });
  it('keeps missing post-crash results nullable unknown in a valid typed incomplete sealed artifact', () => {
    const s = sealed(), records = p1.CASES.map(c => p1.unknownCase(c.variant));
    for (const r of records) {
      fs.writeFileSync(join(s.dir, r.variant + '.case.json'), JSON.stringify(r));
      for (const family of ['guard', 'trace']) fs.writeFileSync(join(s.dir, r.variant + '.' + family + '.jsonl'), '');
    }
    const summary = p1.makeSummary(s.provenance, records, [], null, 'setup-or-outcome-unknown', false);
    fs.writeFileSync(join(s.dir, 'summary.json'), JSON.stringify(summary)); s.rehash();
    expect(p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toBe(true); expect(summary.totalNativeLaunches).toBeNull();
    expect(summary.diagnosticExitCode).toBeNull(); expect(summary.diagnostic_observation_complete).toBe(false);
  });
  it('allows the exact 65536-byte JSON artifact bound but refuses +1 even with a refreshed manifest', () => {
    const s = sealed(), path = join(s.dir, 'T0.case.json'), bytes = fs.readFileSync(path);
    fs.writeFileSync(path, Buffer.concat([bytes, Buffer.alloc(65536 - bytes.length, 32)])); s.rehash();
    expect(p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toBe(true);
    fs.appendFileSync(path, ' '); s.rehash(); expect(() => p1.verifySealedDirectory(s.dir, s.files, s.executionSha)).toThrow();
  });
});

describe('B001-actual-API-source-return-throw-and-owned-native-exit-close-counterexamples-at-T1-T2', () => {
  it.each(['T1', 'T2'])('rejects contradictory actual source/error/owned tuples at %s before any next launch', variant => {
    const count = variant === 'T1' ? 0 : 1;
    const mutations: ((f: any) => void)[] = [
      f => { f.probe.native.errorName = 'BoundedSubprocessLaunchError'; f.probe.native.errorCode = 'EIO'; },
      f => { f.probe.native.errorCode = 'EIO'; }, f => { f.probe.native.metadataSource = 'api-throw'; },
      f => { f.probe.native.metadataSource = 'unknown'; },
      f => { for (const rows of [f.guard, f.trace]) for (const e of rows) if (['child-exit', 'child-close'].includes(e.event)) e.status = 0; },
      f => { f.guard = f.guard.filter((e: Row) => e.event !== 'child-exit'); },
      f => { f.trace = f.trace.filter((e: Row) => e.event !== 'child-close'); },
      f => { f.guard.push(clone(f.guard.find((e: Row) => e.event === 'child-close'))); },
      f => { f.trace.find((e: Row) => e.event === 'child-exit').childPid = 301; },
      f => { f.trace.find((e: Row) => e.event === 'child-close').pid = 201; },
      f => { f.trace.find((e: Row) => e.event === 'spawn-sync').workerKind = 'launch'; }
    ];
    for (const mutate of mutations) {
      const f = fixture(variant, 'refused', count); mutate(f);
      const r = p1.evaluateCase(f); expect(r.native.outcome).toBe('unknown'); expect(r.diagnostic_observation_complete).toBe(false);
      expect(p1.selection(r).action).toBe('stop-unknown'); expect(r.health?.rootRetained).toBe(true);
    }
    for (const mutate of [
      (f: any) => { f.probe.native.status = 0; }, (f: any) => { f.probe.native.errorCode = 'EIO'; },
      (f: any) => { f.probe.native.signal = 'SIGKILL'; }, (f: any) => { f.probe.native.workerKind = 'ok'; },
      (f: any) => { f.probe.native.errorName = 'DiagnosticEvidenceError'; }
    ]) {
      const f = fixture(variant, 'timeout', count); mutate(f); const r = p1.evaluateCase(f);
      expect(r.native.outcome).toBe('unknown'); expect(p1.selection(r).action).toBe('stop-unknown');
    }
    for (const outcome of ['refused', 'timeout']) {
      const r = p1.evaluateCase(fixture(variant, outcome, count));
      expect(r.diagnostic_observation_complete).toBe(true); expect(p1.selection(r).action).toBe(variant === 'T1' ? 'run-T2' : 'run-T3');
    }
  });
  it('derives API source only from actual return/catch instances, never error text or Node spawn-sync status', () => {
    class Timeout extends Error {} class Launch extends Error { constructor(public code?: string) { super('safe'); } }
    const api = { BoundedSubprocessTimeoutError: Timeout, BoundedSubprocessLaunchError: Launch };
    const timeout = p1.nativeFromApi(api, () => { throw new Timeout(); }, () => 1);
    expect(timeout).toMatchObject({ metadataSource: 'api-throw', status: null, signal: null, errorCode: null, workerKind: null });
    expect(p1.nativeFromApi(api, () => { throw new Launch('EIO'); }, () => 1).errorCode).toBe('EIO');
    expect(p1.nativeFromApi(api, () => { throw new Launch(); }, () => 1).errorCode).toBeNull();
    expect(p1.nativeFromApi(api, () => { throw Object.assign(new Error('BoundedSubprocessTimeoutError'), { code: 'EIO' }); }, () => 1)).toEqual(p1.unknownNative());
    expect(p1.nativeFromApi(api, () => ({ status: 1, signal: null }), () => 1)).toMatchObject({ metadataSource: 'api-return', errorName: null, errorCode: null });
    const f = fixture('T1', 'refused', 0); f.trace.find((e: Row) => e.event === 'spawn-sync').status = 1;
    expect(p1.evaluateCase(f).native.outcome).toBe('unknown');
  });
});
