import fs from 'node:fs';
import cp from 'node:child_process';
import { errorMonitor } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, resolve, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { release } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { evidenceEvent as baselineEvent, safeCode, rootMetadata } from '../windows-release-diagnosis-20261008/native-runtime-parity.mjs';

const self = fileURLToPath(new URL('./p1-stages.mjs', import.meta.url));
const repo = resolve(dirname(self), '../../..');
const bindingPath = 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json';
const bindingHash = 'ed24ebf3b4b1890f84f09ba82edd0d71f75a12e35504a84a3fb0f9d8300455fc';
const mdPath = 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md';
const mdHash = 'bf60ca426602d00b76515091cc30abd37badea21731b6ad21fe54cd323d7577c';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const bindingBytes = fs.readFileSync(join(repo, bindingPath));
assert.equal(sha256(bindingBytes), bindingHash, 'binding identity');
export const BINDINGS = JSON.parse(bindingBytes);
export const CASES = BINDINGS.cases;
export const BOUNDS = BINDINGS.bounds;
const defs = BINDINGS.schemas.$defs;
const scratch = join(repo, BINDINGS.output.scratch_root);
const upload = join(repo, BINDINGS.output.upload_root);
const workerPath = join(repo, 'src/cli/bounded-subprocess-worker.mjs');
const guardUrl = pathToFileURL(self); guardUrl.searchParams.set('guard', '1');
const traceUrl = pathToFileURL(join(repo, BINDINGS.environment.old_trace_import)).href;
const nativeArgs = c => [...BINDINGS.native.argv_prefix, c.script];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uint = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const pid = n => uint(n, 0xffffffff) && n > 0;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  keys.length === Object.keys(v).length && keys.every(k => Object.hasOwn(v, k));
const caseFor = variant => { const c = CASES.find(c => c.variant === variant); assert(c, 'fixed variant required'); return c; };
const sorted = values => [...new Set(values)].sort();
const canary = text => /TW_RAW_CONTENT_CANARY|RAW-STDERR-CANARY|PRIVATE|reader/.test(text);
const original = Object.fromEntries(['mkdirSync', 'rmdirSync', 'lstatSync', 'fstatSync', 'openSync',
  'readFileSync', 'readSync', 'writeSync', 'writeFileSync', 'closeSync', 'appendFileSync', 'realpathSync',
  'readdirSync', 'rmSync'].map(k => [k, fs[k].bind(fs)]));

export function schemaMatches(schema, value) {
  if (schema.$ref) return schemaMatches(defs[schema.$ref.slice(8)], value);
  if (schema.const !== undefined && !same(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some(v => same(v, value))) return false;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) :
      t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) :
      t === 'integer' ? Number.isSafeInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t)) return false;
  }
  if (schema.anyOf && !schema.anyOf.some(s => schemaMatches(s, value))) return false;
  if (schema.allOf && !schema.allOf.every(s => schemaMatches(s, value))) return false;
  if (schema.not && schemaMatches(schema.not, value)) return false;
  if (schema.if && schemaMatches(schema.if, value) && schema.then && !schemaMatches(schema.then, value)) return false;
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) ||
    (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (typeof value === 'string' && ((schema.maxLength !== undefined && value.length > schema.maxLength) ||
    (schema.pattern && !new RegExp(schema.pattern).test(value)))) return false;
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems) ||
      (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length)) return false;
    if (schema.items && !value.every(v => schemaMatches(schema.items, v))) return false;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required && !schema.required.every(k => Object.hasOwn(value, k))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(k => !Object.hasOwn(schema.properties ?? {}, k))) return false;
    if (schema.properties && !Object.entries(value).every(([k, v]) => !schema.properties[k] || schemaMatches(schema.properties[k], v))) return false;
  }
  return true;
}
export function rebuild(name, value) {
  try { return schemaMatches(defs[name], value) ? JSON.parse(JSON.stringify(value)) : null; } catch { return null; }
}
export function validateBindings() {
  assert.equal(sha256(original.readFileSync(join(repo, mdPath))), mdHash);
  for (const input of [...BINDINGS.prior_inputs, ...BINDINGS.frozen_runtime_sources])
    assert.equal(sha256(original.readFileSync(join(repo, input.path))), input.sha256, 'frozen input');
  assert.equal(CASES.length, 4);
  for (const c of CASES) assert.equal(sha256(c.script), c.scriptSha256);
  assert.equal(Math.max(...Object.values(BINDINGS.tokens).map(t => Buffer.byteLength(t))) + 2, BOUNDS.pending_line_bytes);
  assert.deepEqual(CASES.map(c => c.variant), ['T0', 'T1', 'T2', 'T3']);
  return true;
}

export function evidenceEvent(family, value) {
  if (family === 'guard' && value?.event === 'native-fixed-stage') return rebuild('stage', value);
  if (family === 'guard' && value?.event === 'native-fixed-stream-end') {
    const v = rebuild('streamEnd', value);
    if (!v || v.eofObserved !== (v.stdoutEofObserved && v.stderrEofObserved) ||
      (v.combinedBytes <= BOUNDS.native_output_bytes && v.combinedBytes !== v.stdoutBytes + v.stderrBytes) ||
      (v.combinedBytes > BOUNDS.native_output_bytes && (v.state !== 'invalid' || v.reason !== 'native-output-cap')) ||
      (v.reason === 'native-output-cap' && v.combinedBytes !== BOUNDS.native_output_bytes + 1) ||
      (v.stderrBytes > 0 && v.state !== 'invalid') ||
      (['complete-prefix', 'complete-sequence'].includes(v.state) && (!v.eofObserved || v.reason !== 'none')) ||
      (v.state === 'unknown' && !['stream-error', 'eof-not-observed'].includes(v.reason)) ||
      (v.state === 'invalid' && !['unexpected-bytes', 'order-or-duplicate', 'unterminated-line', 'native-output-cap'].includes(v.reason))) return null;
    return v;
  }
  const v = baselineEvent(family, value);
  return family === 'counter' && v?.kind !== 'smoke' ? null : v;
}
export function parseRows(bytes, family, cap = BOUNDS.guard_bytes) {
  try {
    assert(Buffer.isBuffer(bytes) && bytes.length <= cap);
    if (!bytes.length) return { rows: [], text: '', invalid: false };
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    assert(!text.startsWith('\uFEFF') && text.endsWith('\n') && !canary(text));
    const rows = text.slice(0, -1).split('\n').map(line => {
      assert(line.length);
      const v = JSON.parse(line), rebuilt = evidenceEvent(family, v);
      assert(rebuilt && JSON.stringify(v) === line);
      return rebuilt;
    });
    if (family !== 'counter') {
      const seq = new Map();
      for (const row of rows) { assert.equal(row.sequence, seq.get(row.pid) ?? 0); seq.set(row.pid, row.sequence + 1); }
    }
    const rebuiltText = rows.map(row => JSON.stringify(row) + '\n').join('');
    assert(Buffer.byteLength(rebuiltText) <= cap);
    return { rows, text: rebuiltText, invalid: false };
  } catch { return { rows: [], text: '', invalid: true }; }
}
export function counterState(bytes) {
  const parsed = parseRows(bytes, 'counter', BOUNDS.counter_bytes);
  assert(!parsed.invalid && parsed.rows.length <= BOUNDS.total_ps, 'counter unavailable');
  const total = parsed.rows.length, smoke = parsed.rows.filter(r => r.kind === 'smoke').length;
  assert(smoke <= BOUNDS.smoke_ps && total === smoke);
  return { total, smoke, rows: parsed.rows };
}
export function countBytes(counts, stream, length, cap) {
  assert(['stdout', 'stderr'].includes(stream) && uint(length) && uint(cap) && cap > 0);
  const result = { ...counts, combinedBytes: Math.min(cap + 1, counts.combinedBytes + length) };
  const key = stream === 'stdout' ? 'stdoutBytes' : 'stderrBytes';
  result[key] = Math.min(cap, counts[key] + length); return result;
}
export function caseAdmission({ now, deadline, usedTotal, usedSmoke }) {
  if (![now, deadline, usedTotal, usedSmoke].every(n => uint(n)) || usedSmoke > usedTotal || usedTotal > BOUNDS.total_ps || usedSmoke > BOUNDS.smoke_ps) return false;
  return deadline - now <= BOUNDS.total_ms && deadline - now >= BOUNDS.case_ms + BOUNDS.cleanup_ms && usedTotal + 1 <= BOUNDS.total_ps &&
    usedSmoke + 1 <= BOUNDS.smoke_ps && usedTotal + 1 <= BOUNDS.initial_max_ps;
}
export function nativeAdmission({ now, deadline, timeoutMs, usedTotal, usedSmoke }) {
  if (![now, deadline, usedTotal, usedSmoke].every(n => uint(n)) || usedSmoke > usedTotal) return 'unknown-native-budget';
  if (timeoutMs !== BOUNDS.native_ms) return 'unknown-native-budget';
  if (deadline - now > BOUNDS.case_ms) return 'unknown-native-budget';
  if (deadline - now < timeoutMs + BOUNDS.cleanup_ms) return 'native-cleanup-output-allowance-insufficient';
  if (usedTotal >= BOUNDS.total_ps || usedTotal >= BOUNDS.initial_max_ps) return 'total-powershell-budget-insufficient';
  if (usedSmoke >= BOUNDS.smoke_ps) return 'smoke-powershell-budget-insufficient';
  return null;
}

const identity = s => ({ dev: s.dev, ino: s.ino });
const equalIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
function safeDirectory(path, io = original) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const st = io.lstatSync(current);
    assert(st.isDirectory() && !st.isSymbolicLink(), 'owned directory identity');
  }
  assert.equal(io.realpathSync(path), absolute, 'no directory alias');
  return identity(io.lstatSync(path));
}
function safeFile(path, expected, io = original) {
  safeDirectory(dirname(path), io);
  const s = io.lstatSync(path);
  assert(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && uint(s.size), 'owned regular file');
  if (expected) assert(equalIdentity(identity(s), expected), 'owned file replaced');
  return s;
}
// Saved primitives deliberately bypass old trace: lock/read/write operations are an observation-I/O delta.
export function createAppendGate(targets, io = original, onFailure = () => {}) {
  const bound = new Map(targets.map(t => {
    assert.equal(resolve(t.path), t.path);
    const parent = safeDirectory(dirname(t.path), io), file = identity(safeFile(t.path, null, io));
    return [t.path, { ...t, parent, file, lock: t.path + '.append-lock' }];
  }));
  const transaction = (path, build) => {
    const t = bound.get(path); assert(t, 'exact append target');
    let acquired = false, lockId, fd, failure;
    try {
      io.mkdirSync(t.lock); acquired = true;
      lockId = safeDirectory(t.lock, io);
      assert(equalIdentity(safeDirectory(dirname(path), io), t.parent));
      const before = safeFile(path, t.file, io);
      assert(before.size <= t.cap, 'inclusive append cap');
      fd = io.openSync(path, 'r+');
      const st = io.fstatSync(fd);
      assert(st.isFile() && equalIdentity(identity(st), t.file) && st.size === before.size);
      const current = Buffer.alloc(before.size);
      assert.equal(io.readSync(fd, current, 0, current.length, 0), current.length);
      const candidate = build(current);
      assert(Buffer.isBuffer(candidate) && current.length + candidate.length <= t.cap, 'inclusive append cap');
      const written = io.writeSync(fd, candidate, 0, candidate.length, current.length);
      assert.equal(written, candidate.length, 'partial append');
      const after = io.fstatSync(fd), named = safeFile(path, t.file, io);
      assert(equalIdentity(identity(after), t.file) && after.size === current.length + candidate.length && named.size === after.size);
      const whole = Buffer.alloc(after.size);
      assert.equal(io.readSync(fd, whole, 0, whole.length, 0), whole.length);
      assert(whole.subarray(current.length).equals(candidate), 'append bytes changed');
    } catch (error) { failure = error; }
    finally {
      if (fd !== undefined) { try { io.closeSync(fd); } catch (error) { failure ??= error; } }
      if (acquired) {
        try { assert(equalIdentity(safeDirectory(t.lock, io), lockId)); io.rmdirSync(t.lock); }
        catch (error) { failure ??= error; }
      }
    }
    if (failure) { onFailure(path); throw Object.assign(new Error('bounded evidence append failed'), { code: path.endsWith('trace.jsonl') ? 'TRACE_IO_OR_SERIALIZATION' : 'GUARD_LOG_IO_OR_LIMIT' }); }
  };
  return { has: p => bound.has(p), transaction, append(path, value) {
    transaction(path, current => {
      assert(typeof value === 'string' || Buffer.isBuffer(value));
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
      const family = bound.get(path).family;
      assert(!parseRows(current, family, bound.get(path).cap).invalid);
      const aggregate = parseRows(Buffer.concat([current, bytes]), family, bound.get(path).cap);
      assert(!aggregate.invalid && family !== 'counter', 'counter requires admission transaction');
      return bytes;
    });
  } };
}
export function installAppendWrapper(filesystem, gate, synchronize = syncBuiltinESMExports) {
  const append = filesystem.appendFileSync;
  filesystem.appendFileSync = function (path, value, options) {
    if (!gate.has(path)) return append.call(this, path, value, options);
    assert(options === undefined || options === 'utf8' || (exact(options, ['encoding']) && options.encoding === 'utf8'));
    return gate.append(path, value);
  };
  synchronize();
}

export function createRecorder(variant, persist, now = () => performance.now()) {
  const c = caseFor(variant), started = now(), line = Buffer.alloc(BOUNDS.pending_line_bytes);
  let pending = 0, out = 0, err = 0, combined = 0, reason = null, streamError = false, ended = false;
  let stdoutEof = false, stderrEof = false;
  const markers = [];
  const invalid = why => { reason ??= why; pending = 0; };
  const feed = (stream, chunk) => {
    if (ended) return;
    if (!Buffer.isBuffer(chunk) || !['stdout', 'stderr'].includes(stream)) { streamError = true; return; }
    const counts = countBytes({ stdoutBytes: out, stderrBytes: err, combinedBytes: combined }, stream, chunk.length, BOUNDS.native_output_bytes);
    out = counts.stdoutBytes; err = counts.stderrBytes; combined = counts.combinedBytes;
    if (combined > BOUNDS.native_output_bytes) { reason = 'native-output-cap'; pending = 0; return; }
    if (stream === 'stderr' && chunk.length) { invalid('unexpected-bytes'); return; }
    if (reason || streamError) return;
    for (const byte of chunk) {
      if (byte === 10) {
        const length = pending && line[pending - 1] === 13 ? pending - 1 : pending;
        const token = line.subarray(0, length).toString('ascii');
        const marker = Object.keys(BINDINGS.tokens).find(k => BINDINGS.tokens[k] === token);
        pending = 0;
        if (!marker) { invalid('unexpected-bytes'); break; }
        if (c.sequence[markers.length] !== marker) { invalid('order-or-duplicate'); break; }
        const elapsed = now() - started;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > BOUNDS.case_ms) { streamError = true; break; }
        persist({ event: 'native-fixed-stage', variant, marker, ordinal: markers.length, arrivalElapsedMs: elapsed });
        markers.push(marker);
      } else {
        if (byte > 127 || byte === 0 || pending >= line.length) { invalid('unexpected-bytes'); break; }
        line[pending++] = byte;
      }
    }
  };
  const end = stream => {
    if (stream === 'stdout') { stdoutEof = true; if (pending) invalid('unterminated-line'); }
    else if (stream === 'stderr') stderrEof = true;
    else streamError = true;
  };
  const finish = () => {
    if (ended) return null;
    ended = true;
    if (pending && !reason) invalid('unterminated-line');
    const eof = stdoutEof && stderrEof;
    const state = reason ? 'invalid' : streamError || !eof ? 'unknown' : markers.length === c.sequence.length ? 'complete-sequence' : 'complete-prefix';
    const why = reason ?? (streamError ? 'stream-error' : !eof ? 'eof-not-observed' : 'none');
    const event = { event: 'native-fixed-stream-end', variant, stdoutBytes: out, stderrBytes: err, combinedBytes: combined,
      acceptedMarkers: markers.length, stdoutEofObserved: stdoutEof, stderrEofObserved: stderrEof, eofObserved: eof, state, reason: why };
    persist(event); return event;
  };
  return { feed, end, error: () => { streamError = true; }, finish, markers };
}
export function matchNativeIdentity({ root, command, args, options, argv, childPid }) {
  const c = CASES.find(c => basename(root) === c.caseId);
  if (!c || command !== 'powershell.exe' || !same(args, nativeArgs(c)) || !pid(childPid) || options?.windowsHide !== true ||
    (options.shell !== undefined && options.shell !== false) || options.detached !== false || options.cwd !== root ||
    !same(options.stdio, ['ignore', 'pipe', 'pipe']) || argv?.[1] !== workerPath) return null;
  try {
    const payload = JSON.parse(argv[2]);
    if (!exact(payload, ['command', 'args', 'timeoutMs', 'maxOutputBytes', 'cwd', 'cleanupMs']) || payload.command !== command ||
      !same(payload.args, args) || payload.cwd !== root || payload.timeoutMs !== BOUNDS.native_ms ||
      payload.maxOutputBytes !== BOUNDS.native_output_bytes || payload.cleanupMs !== 1000) return null;
    return c;
  } catch { return null; }
}
export function attachNativeRecorder(child, context, persist, now) {
  const c = matchNativeIdentity({ ...context, childPid: child.pid });
  if (!c) return null;
  const recorder = createRecorder(c.variant, event => persist({ childPid: child.pid, ...event }), now);
  for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    if (!stream) { recorder.error(); continue; }
    stream.on('data', chunk => recorder.feed(name, chunk));
    stream.on('end', () => recorder.end(name));
    stream.on(errorMonitor, () => recorder.error());
  }
  child.on('close', () => recorder.finish());
  return recorder;
}

function fixedEnvironment(system, root, runRoot, deadline, totalDeadline) {
  return { ...system, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'home', 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0',
    TW_ROOT: root, TW_TRACE: join(root, 'trace.jsonl'), TW_TRACE_HEALTH: join(root, 'trace-health'), TW_PARITY_RUN_ROOT: runRoot,
    TW_PARITY_COUNTER: join(runRoot, 'counter.jsonl'), TW_PARITY_GUARD_LOG: join(root, 'guard.jsonl'), TW_PARITY_GUARD_HEALTH: join(root, 'guard-health'),
    TW_PARITY_CASE_DEADLINE: String(deadline), TW_PARITY_TOTAL_DEADLINE: String(totalDeadline), TW_PARITY_KIND: 'smoke', TW_PARITY_ARM: 'E0',
    TW_PARITY_TRACE: 'on', TW_PARITY_CASE: 'smoke', NODE_OPTIONS: '--import=' + guardUrl.href + ' --import=' + traceUrl };
}
export function systemEnvironment(base) {
  const system = {};
  for (const key of BINDINGS.environment.system_keys) {
    const matches = Object.keys(base).filter(k => k.toLowerCase() === key.toLowerCase());
    assert(matches.length <= 1, 'ambiguous environment key');
    if (matches.length) { assert(typeof base[matches[0]] === 'string'); system[key] = base[matches[0]]; }
  }
  return system;
}
function guardConfiguration() {
  const env = process.env, root = env.TW_ROOT, runRoot = env.TW_PARITY_RUN_ROOT;
  assert(root && runRoot && CASES.some(c => root === join(runRoot, c.caseId)));
  const caseDeadline = Number(env.TW_PARITY_CASE_DEADLINE), totalDeadline = Number(env.TW_PARITY_TOTAL_DEADLINE);
  assert(uint(caseDeadline) && uint(totalDeadline) && caseDeadline <= totalDeadline && caseDeadline - Date.now() <= BOUNDS.case_ms);
  const expected = fixedEnvironment(systemEnvironment(env), root, runRoot, caseDeadline, totalDeadline);
  assert.deepEqual(sorted(Object.keys(env)), sorted(Object.keys(expected)));
  for (const key of Object.keys(expected)) assert.equal(env[key], expected[key], 'fixed owned environment');
  safeDirectory(root); safeDirectory(runRoot);
  return { env, root, runRoot, caseDeadline, totalDeadline };
}
function installGuard() {
  const { env, root, runRoot, caseDeadline, totalDeadline } = guardConfiguration();
  const healthPath = join(env.TW_PARITY_GUARD_HEALTH, process.pid + '.json');
  let failed = false, reasonCode = null, sequence = 0, stopping = false, nativeLaunches = 0;
  const recorders = new Set(), children = new Set();
  const health = state => { try { original.writeFileSync(healthPath, JSON.stringify({ pid: process.pid, state, ...(reasonCode ? { reasonCode } : {}) }) + '\n'); }
    catch { failed = true; reasonCode ??= 'GUARD_HEALTH_IO'; } };
  const fail = code => { failed = true; reasonCode ??= code; health('failed'); };
  const gate = createAppendGate([
    { path: env.TW_PARITY_GUARD_LOG, cap: BOUNDS.guard_bytes, family: 'guard' },
    { path: env.TW_TRACE, cap: BOUNDS.trace_bytes, family: 'trace' },
    { path: env.TW_PARITY_COUNTER, cap: BOUNDS.counter_bytes, family: 'counter' }
  ], original, path => fail(path === env.TW_PARITY_COUNTER ? 'GUARD_COUNTER_IO' : 'GUARD_LOG_IO_OR_LIMIT'));
  installAppendWrapper(fs, gate);
  const log = event => {
    try {
      const rebuilt = evidenceEvent('guard', { pid: process.pid, sequence: sequence++, at: Date.now(), ...event });
      assert(rebuilt); gate.append(env.TW_PARITY_GUARD_LOG, JSON.stringify(rebuilt) + '\n');
    } catch { fail('GUARD_LOG_IO_OR_LIMIT'); }
  };
  const originalSpawn = cp.spawn, originalSync = cp.spawnSync;
  const stop = child => {
    const m = rootMetadata(child);
    if (m.unknown || !m.pid || m.status !== null || m.signal !== null) return;
    try { originalSync('taskkill.exe', ['/pid', String(m.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 1000, killSignal: 'SIGKILL' }); } catch { /* unknown remains separate */ }
    try { child.kill('SIGKILL'); } catch { /* only the live owned handle */ }
  };
  health('pending');
  process.once('exit', () => { for (const r of recorders) r.finish(); health(failed ? 'failed' : 'complete'); });
  const expiry = Math.min(caseDeadline, totalDeadline);
  const timer = setTimeout(() => {
    if (stopping) return; stopping = true;
    log({ event: 'owned-lifetime-expired' }); log({ event: 'diagnostic-budget-abort', reason: 'owned-lifetime-expired' });
    for (const child of children) stop(child); process.exit(92);
  }, Math.max(1, Math.min(BOUNDS.case_ms, expiry - Date.now()))); timer.unref();
  const executable = command => typeof command === 'string' && /^(node(?:\.exe)?|powershell\.exe|taskkill\.exe|git(?:\.exe)?)$/i.test(basename(command)) ? basename(command).toLowerCase() : 'other';
  cp.spawn = function (command, args, options) {
    const exe = executable(command);
    if (exe === 'powershell.exe') {
      let reason = null;
      try {
        assert(nativeLaunches === 0 && process.argv[1] === workerPath);
        const payload = JSON.parse(process.argv[2]), c = CASES.find(c => basename(root) === c.caseId);
        assert(c && same(args, nativeArgs(c)) && command === 'powershell.exe' && payload.command === command && same(payload.args, args));
        assert(matchNativeIdentity({ root, command, args, options, argv: process.argv, childPid: 1 }));
        gate.transaction(env.TW_PARITY_COUNTER, bytes => {
          const used = counterState(bytes);
          reason = nativeAdmission({ now: Date.now(), deadline: expiry, timeoutMs: payload.timeoutMs, usedTotal: used.total, usedSmoke: used.smoke });
          if (reason) throw new Error('admission denied');
          return Buffer.from(JSON.stringify({ event: 'powershell-admission', kind: 'smoke' }) + '\n');
        });
        nativeLaunches++;
      } catch { reason ??= 'native-budget-counter-unavailable'; fail('GUARD_COUNTER_IO'); }
      if (reason || failed) {
        log({ event: 'diagnostic-budget-abort', reason: reason ?? 'native-budget-counter-unavailable' });
        throw Object.assign(new Error('diagnostic budget unavailable'), { code: 'TW_PARITY_BUDGET' });
      }
    }
    const child = originalSpawn.call(this, command, args, options);
    children.add(child);
    log({ event: 'spawn', executable: exe, childPid: child.pid ?? null, detached: options?.detached ?? false });
    child.on(errorMonitor, error => {
      const code = safeCode(error?.code);
      if (code === 'UNRECOGNIZED_ERROR_CODE') fail('GUARD_UNSAFE_METADATA');
      log({ event: 'child-error', executable: exe, childPid: child.pid ?? null, code });
    });
    child.on('exit', (status, signal) => log({ event: 'child-exit', executable: exe, childPid: child.pid ?? null, status, signal }));
    let recorder = null;
    if (exe === 'powershell.exe') {
      const matched = matchNativeIdentity({ root, command, args, options, argv: process.argv, childPid: child.pid });
      if (!matched) fail('GUARD_UNSAFE_METADATA');
      else {
        recorder = attachNativeRecorder(child, { root, command, args, options, argv: process.argv }, log);
        recorders.add(recorder);
        if (!child.stdout || !child.stderr) fail('GUARD_UNSAFE_METADATA');
      }
    }
    child.on('close', (status, signal) => {
      recorder?.finish(); if (recorder) recorders.delete(recorder);
      children.delete(child); log({ event: 'child-close', executable: exe, childPid: child.pid ?? null, status, signal });
    });
    return child;
  };
  cp.spawnSync = function (command, args, options) {
    if (executable(command) === 'powershell.exe') {
      log({ event: 'diagnostic-budget-abort', reason: 'unexpected-synchronous-powershell' });
      throw Object.assign(new Error('diagnostic budget unavailable'), { code: 'TW_PARITY_BUDGET' });
    }
    if (command === process.execPath && args?.[0] === workerPath) {
      try {
        const p = JSON.parse(args[1]), c = CASES.find(c => basename(root) === c.caseId);
        assert(c && exact(p, ['command', 'args', 'timeoutMs', 'maxOutputBytes', 'cwd', 'cleanupMs']) &&
          p.command === 'powershell.exe' && same(p.args, nativeArgs(c)) && p.cwd === root && p.timeoutMs === BOUNDS.native_ms &&
          p.maxOutputBytes === BOUNDS.native_output_bytes && p.cleanupMs === 1000 && options?.env?.TW_ROOT === root);
      } catch { fail('GUARD_UNSAFE_METADATA'); throw Object.assign(new Error('diagnostic ownership unavailable'), { code: 'TW_PARITY_BUDGET' }); }
    }
    const result = originalSync.call(this, command, args, options), code = safeCode(result.error?.code);
    if (code === 'UNRECOGNIZED_ERROR_CODE') fail('GUARD_UNSAFE_METADATA');
    log({ event: 'spawn-sync', executable: executable(command), childPid: result.pid ?? null, status: result.status, signal: result.signal, code });
    return result;
  };
  syncBuiltinESMExports();
  log({ event: 'guard-preload', commonBudgetGuardOn: true, oldTracePreloadOn: true });
}

export const unknownNative = () => ({ outcome: 'unknown', metadataSource: 'unknown', status: null, signal: null,
  errorName: null, errorCode: null, elapsedMs: null, workerKind: null });
const notStartedNative = () => ({ ...unknownNative(), outcome: 'not-started', metadataSource: 'not-started' });
export function workerFacts(guard, trace, rootPid) {
  try {
    assert(pid(rootPid));
    assert(Array.isArray(guard) && Array.isArray(trace));
    assert(!parseRows(Buffer.from(guard.map(e => JSON.stringify(e) + '\n').join('')), 'guard').invalid &&
      !parseRows(Buffer.from(trace.map(e => JSON.stringify(e) + '\n').join('')), 'trace').invalid);
    const nativeSpawns = family => family.filter(e => e.event === 'spawn' && e.executable === 'powershell.exe');
    const gs = nativeSpawns(guard), ts = nativeSpawns(trace);
    assert.equal(gs.length, 1); assert.equal(ts.length, 1);
    const spawn = gs[0];
    assert(pid(spawn.childPid) && pid(spawn.pid) && spawn.pid !== rootPid && !spawn.detached);
    assert(ts[0].pid === spawn.pid && ts[0].childPid === spawn.childPid && !ts[0].detached);
    const guards = guard.filter(e => e.pid === rootPid && e.event === 'spawn-sync' && /^node(?:\.exe)?$/.test(e.executable) && e.childPid === spawn.pid);
    const workers = trace.filter(e => e.pid === rootPid && e.event === 'spawn-sync' && /^node(?:\.exe)?$/.test(e.executable) && e.childPid === spawn.pid);
    assert.equal(guards.length, 1); assert.equal(workers.length, 1);
    assert.equal(workers[0].status, 0); assert.equal(workers[0].signal, null); assert.equal(workers[0].code, null);
    assert.equal(guards[0].status, workers[0].status); assert.equal(guards[0].signal, workers[0].signal); assert.equal(guards[0].code, null);
    assert(['ok', 'timeout', 'output', 'launch', 'supervision'].includes(workers[0].workerKind));
    const facts = [];
    for (const rows of [guard, trace]) for (const event of ['child-exit', 'child-close']) {
      const candidates = rows.filter(e => e.executable === 'powershell.exe' && e.event === event);
      assert.equal(candidates.length, 1);
      const fact = candidates[0];
      assert(fact.pid === spawn.pid && fact.childPid === spawn.childPid && fact.sequence > (rows === guard ? gs[0].sequence : ts[0].sequence));
      facts.push(fact);
    }
    assert(facts.every(f => f.status === facts[0].status && f.signal === facts[0].signal));
    return { workerPid: spawn.pid, childPid: spawn.childPid, workerKind: workers[0].workerKind,
      status: facts[0].status, signal: facts[0].signal, spawnSequence: spawn.sequence };
  } catch { return null; }
}
export function reconcileNative(value, guard, trace, rootPid) {
  const native = rebuild('native', value), facts = workerFacts(guard, trace, rootPid);
  if (!native || !facts || native.workerKind !== facts.workerKind) return { native: unknownNative(), facts, valid: false };
  if (native.metadataSource === 'api-return' && (native.status !== facts.status || native.signal !== facts.signal))
    return { native: unknownNative(), facts, valid: false };
  if (native.metadataSource === 'api-return' && !['completed', 'refused'].includes(native.outcome))
    return { native: unknownNative(), facts, valid: false };
  if (native.metadataSource !== 'api-return' && native.metadataSource !== 'api-throw')
    return { native: unknownNative(), facts, valid: false };
  const kindByOutcome = { timeout: 'timeout', output: 'output', launch: 'launch', supervision: 'supervision' };
  if (native.metadataSource === 'api-throw' && native.outcome === 'output' && !['ok', 'output'].includes(native.workerKind))
    return { native: unknownNative(), facts, valid: false };
  if (native.metadataSource === 'api-throw' && native.outcome !== 'output' && native.workerKind !== kindByOutcome[native.outcome])
    return { native: unknownNative(), facts, valid: false };
  return { native, facts, valid: true };
}
export function stageFacts(variant, guard, facts) {
  try {
    const c = caseFor(variant); assert(facts);
    const stages = guard.filter(e => e.event === 'native-fixed-stage'), ends = guard.filter(e => e.event === 'native-fixed-stream-end');
    assert.equal(ends.length, 1);
    const stream = ends[0];
    assert(evidenceEvent('guard', stream) && stream.pid === facts.workerPid && stream.childPid === facts.childPid && stream.variant === variant);
    assert(stream.sequence > facts.spawnSequence && stream.acceptedMarkers === stages.length && stages.length <= c.sequence.length);
    let previous = -1;
    stages.forEach((s, index) => {
      assert(rebuild('stage', s) && s.pid === facts.workerPid && s.childPid === facts.childPid && s.variant === variant &&
        s.ordinal === index && s.marker === c.sequence[index] && s.sequence > facts.spawnSequence && s.sequence < stream.sequence && s.arrivalElapsedMs >= previous);
      previous = s.arrivalElapsedMs;
    });
    const complete = stages.length === c.sequence.length;
    if (stream.state === 'complete-sequence') assert(complete);
    if (stream.state === 'complete-prefix') assert(!complete);
    return { markers: stages.map(s => s.marker), stream, valid: ['complete-prefix', 'complete-sequence'].includes(stream.state) };
  } catch { return { markers: [], stream: null, valid: false }; }
}
export function skippedCase(variant, reason) {
  const c = caseFor(variant);
  return { format: 'windows-p1-initial-case-v1', variant, caseId: c.caseId, scriptSha256: c.scriptSha256,
    decision: 'skipped', reason, rootProcessStarted: false, nativeLaunches: 0, markers: [], notObserved: [...c.sequence],
    stream: null, native: notStartedNative(), root: null, health: null, prefix_protocol_valid: false,
    native_completed: false, diagnostic_observation_complete: false, releaseReady: false, releaseAcceptance: false };
}
export function unknownCase(variant, reason = 'setup-or-outcome-unknown') {
  const c = caseFor(variant);
  return { format: 'windows-p1-initial-case-v1', variant, caseId: c.caseId, scriptSha256: c.scriptSha256,
    decision: 'unknown', reason, rootProcessStarted: null, nativeLaunches: null, markers: [], notObserved: [...c.sequence],
    stream: null, native: unknownNative(), root: null, health: null, prefix_protocol_valid: false,
    native_completed: false, diagnostic_observation_complete: false, releaseReady: false, releaseAcceptance: false };
}
function healthTrust(h) {
  return h && h.expectedPids.length > 0 && h.guardComplete && h.traceComplete && !h.guardInvalid && !h.traceInvalid && !h.provenanceUnknown && !h.cleanupUnknown &&
    !h.diagnosticAbortReasons.length && !h.possibleLiveAfterOwnedCap.length && !h.rootRetained;
}
function rootTrust(r) {
  return r && r.status === 0 && r.signal === null && !r.metadataUnknown && !r.stopped && r.launchCode === null &&
    r.stderrBytes === 0 && !r.outputBoundExceeded && !r.canaryFound && r.stdoutBytes + r.stderrBytes <= BOUNDS.case_output_bytes;
}
export function evaluateCase({ variant, probe, root, health, guard, trace, launches, counterKnown }) {
  const c = caseFor(variant), safeRoot = rebuild('root', root), safeHealth = rebuild('health', health);
  const safeProbe = rebuild('probe', probe);
  const identityOK = safeProbe && safeProbe.probeSetupComplete && safeProbe.variant === variant && safeProbe.caseId === c.caseId && safeProbe.scriptSha256 === c.scriptSha256;
  const closure = reconcileNative(identityOK ? safeProbe.native : null, guard, trace, safeRoot?.pid);
  const stage = stageFacts(variant, guard, closure.facts);
  const processes = expectedProcesses(guard, trace, safeRoot?.pid);
  const processIdentity = !processes.unknown && safeHealth && same(processes.expected, safeHealth.expectedPids);
  let native = closure.native;
  const markerComplete = same(stage.markers, c.sequence);
  if (native.outcome === 'completed' && !markerComplete) { native = unknownNative(); closure.valid = false; }
  const complete = Boolean(identityOK && safeProbe.probeSetupComplete && safeRoot && safeHealth && closure.valid && stage.valid &&
    rootTrust(safeRoot) && healthTrust(safeHealth) && processIdentity && counterKnown && launches === 1 && ['completed', 'timeout', 'refused'].includes(native.outcome));
  const record = { format: 'windows-p1-initial-case-v1', variant, caseId: c.caseId, scriptSha256: c.scriptSha256,
    decision: closure.valid && identityOK ? 'run' : 'unknown', reason: closure.valid && identityOK ? null : 'prior-observation-unknown',
    rootProcessStarted: safeRoot?.pid ? true : null, nativeLaunches: [0, 1].includes(launches) ? launches : null,
    markers: stage.markers, notObserved: c.sequence.slice(stage.markers.length), stream: stage.stream,
    native, root: safeRoot, health: safeHealth, prefix_protocol_valid: stage.valid,
    native_completed: closure.valid && native.outcome === 'completed' && markerComplete,
    diagnostic_observation_complete: complete, releaseReady: false, releaseAcceptance: false };
  if (!closure.valid || !identityOK || !processIdentity || !stage.stream || stage.stream.state === 'unknown') {
    if (record.health) {
      if (!closure.valid || !identityOK || !processIdentity) record.health.provenanceUnknown = true;
      record.health.cleanupUnknown = true; record.health.rootRetained = true;
    }
  }
  assert(rebuild('caseRecord', record)); return record;
}
export function selection(record) {
  const { variant } = record;
  if (variant === 'T3') return { action: 'stop', reason: null };
  if (!record.diagnostic_observation_complete) return { action: 'stop-unknown', reason: variant === 'T0' ? 'writer-control-not-complete' : 'prior-observation-unknown' };
  if (record.native_completed) return variant === 'T0' ? { action: 'run-T1', reason: null } :
    { action: 'stop', reason: variant === 'T1' ? 'original-p1-complete-no-reproduction' : 'direct-invoke-complete-no-refinement' };
  if (['timeout', 'refused'].includes(record.native.outcome) && record.prefix_protocol_valid &&
    same(record.markers, variant === 'T1' ? [] : ['json-enter'])) {
    if (variant === 'T1') return { action: 'run-T2', reason: null };
    if (variant === 'T2') return { action: 'run-T3', reason: null };
  }
  return { action: 'stop-unknown', reason: variant === 'T0' ? 'writer-control-not-complete' : 'prior-observation-unknown' };
}

export function nativeFromApi(api, invoke, now = () => performance.now()) {
  const start = now();
  try {
    const result = invoke();
    const elapsedMs = now() - start;
    const outcome = result.status === 0 && result.signal === null ? 'completed' :
      Number.isSafeInteger(result.status) && result.status !== 0 && result.signal === null ? 'refused' : 'unknown';
    const value = { outcome, metadataSource: 'api-return', status: result.status, signal: result.signal,
      errorName: null, errorCode: null, elapsedMs, workerKind: null };
    return value;
  } catch (error) {
    const classes = [['BoundedSubprocessTimeoutError', 'timeout'], ['BoundedSubprocessOutputError', 'output'],
      ['BoundedSubprocessLaunchError', 'launch'], ['BoundedSubprocessSupervisionError', 'supervision']];
    const matched = classes.find(([name]) => typeof api[name] === 'function' && error instanceof api[name]);
    if (!matched) return unknownNative();
    const [errorName, outcome] = matched;
    return { outcome, metadataSource: 'api-throw', status: null, signal: null, errorName,
      errorCode: outcome === 'launch' ? safeCode(error.code) : null, elapsedMs: now() - start, workerKind: null };
  }
}
async function runProbe(variant) {
  const c = caseFor(variant), { root } = guardConfiguration();
  assert.equal(basename(root), c.caseId);
  const api = await import(pathToFileURL(join(repo, 'src/cli/bounded-subprocess.ts')).href);
  let native = nativeFromApi(api, () => api.runBoundedSubprocess('powershell.exe', nativeArgs(c), {
    cwd: root, env: process.env, windowsHide: true, timeoutMs: BOUNDS.native_ms, maxOutputBytes: BOUNDS.native_output_bytes
  }));
  const guard = readRows(join(root, 'guard.jsonl'), 'guard'), trace = readRows(join(root, 'trace.jsonl'), 'trace');
  const facts = workerFacts(guard.rows, trace.rows, process.pid);
  if (facts) native.workerKind = facts.workerKind;
  if (!rebuild('native', native)) native = unknownNative();
  const probe = { format: 'windows-p1-initial-probe-v1', variant, caseId: c.caseId, scriptSha256: c.scriptSha256,
    probeSetupComplete: true, native, releaseAcceptance: false };
  assert(rebuild('probe', probe));
  process.stdout.write(JSON.stringify(probe) + '\n');
}

function readOwned(path, cap) {
  const before = safeFile(path);
  assert(before.size <= cap);
  const fd = original.openSync(path, 'r');
  try {
    const stat = original.fstatSync(fd);
    assert(equalIdentity(identity(before), identity(stat)) && stat.size === before.size && stat.isFile());
    const bytes = Buffer.alloc(before.size);
    assert.equal(original.readSync(fd, bytes, 0, bytes.length, 0), bytes.length);
    const after = safeFile(path, identity(before));
    assert(after.size === before.size && original.fstatSync(fd).size === before.size);
    return bytes;
  } finally { original.closeSync(fd); }
}
function readRows(path, family) {
  try { return parseRows(readOwned(path, family === 'counter' ? BOUNDS.counter_bytes : BOUNDS.guard_bytes), family,
    family === 'counter' ? BOUNDS.counter_bytes : BOUNDS.guard_bytes); }
  catch { return { rows: [], text: '', invalid: true }; }
}
function readJson(path, name) {
  const bytes = readOwned(path, BINDINGS.output.json_max_bytes);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF') && !canary(text));
  const value = JSON.parse(text), rebuilt = rebuild(name, value);
  assert.equal(text.replace(/^[\x20\x09\x0a\x0d]+|[\x20\x09\x0a\x0d]+$/g, ''), JSON.stringify(value), 'canonical core JSON');
  assert(rebuilt, 'safe core schema'); return rebuilt;
}
export function parseProbeBytes(bytes) {
  try {
    assert(Buffer.isBuffer(bytes) && bytes.length <= BOUNDS.case_output_bytes);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    assert(!text.startsWith('\uFEFF') && !canary(text));
    const value = JSON.parse(text); assert.equal(text, JSON.stringify(value) + '\n');
    return rebuild('probe', value);
  } catch { return null; }
}
function writeJson(path, name, value) {
  const rebuilt = rebuild(name, value); assert(rebuilt, 'safe output schema');
  const bytes = Buffer.from(JSON.stringify(rebuilt) + '\n');
  assert(bytes.length <= BINDINGS.output.json_max_bytes && !canary(bytes.toString('utf8')));
  original.writeFileSync(path, bytes, { flag: 'wx' });
}
function writeText(path, text, cap = BOUNDS.guard_bytes) {
  assert(Buffer.byteLength(text) <= cap && !canary(text));
  original.writeFileSync(path, text, { flag: 'wx' });
}
function sourceFiles() {
  return [...BINDINGS.future_added_source_paths, bindingPath, ...BINDINGS.frozen_runtime_sources.map(s => s.path)].sort()
    .map(path => ({ path, sha256: sha256(readOwned(join(repo, path), 1024 * 1024)) }));
}
function checkoutSha() {
  const result = cp.spawnSync('git', ['-c', 'core.fileMode=false', 'rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', timeout: BOUNDS.operation_ms,
    maxBuffer: BOUNDS.counter_bytes, windowsHide: true });
  assert(!result.error && result.status === 0 && result.signal === null && result.stderr === '' && /^[a-f0-9]{40}\r?\n$/.test(result.stdout));
  const sha = result.stdout.trim();
  const paths = [...BINDINGS.future_added_source_paths, bindingPath, ...BINDINGS.frozen_runtime_sources.map(s => s.path)];
  const status = cp.spawnSync('git', ['-c', 'core.fileMode=false', 'status', '--porcelain', '--untracked-files=all', '--', ...paths],
    { cwd: repo, encoding: 'utf8', timeout: BOUNDS.operation_ms, maxBuffer: BOUNDS.counter_bytes, windowsHide: true });
  assert(!status.error && status.status === 0 && status.signal === null && status.stdout === '' && status.stderr === '', 'source checkout changed');
  return sha;
}
export function validateProvenance(value, files, executionSha) {
  const v = rebuild('provenance', value);
  if (!v || v.executionSha !== v.expectedSha || v.executionSha !== executionSha || !same(v.sourceFiles, files)) return false;
  const paths = [...BINDINGS.future_added_source_paths, bindingPath, ...BINDINGS.frozen_runtime_sources.map(s => s.path)].sort();
  if (!same(v.sourceFiles.map(s => s.path), paths)) return false;
  for (const frozen of BINDINGS.frozen_runtime_sources) if (v.sourceFiles.find(s => s.path === frozen.path)?.sha256 !== frozen.sha256) return false;
  if (v.sourceFiles.find(s => s.path === bindingPath)?.sha256 !== bindingHash) return false;
  const presentSystem = v.environmentKeyNames.filter(k => BINDINGS.environment.system_keys.includes(k));
  return same(v.environmentKeyNames, sorted([...presentSystem, ...BINDINGS.environment.synthetic_keys])) && v.extraEnvironmentKeys.length === 0;
}
function assertWindowsRunner() {
  assert(process.platform === 'win32' && process.arch === 'x64' && /^v22\./.test(process.version), 'native Windows Node22 x64 required');
  assert(process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === BINDINGS.workflow.job_if.split("github.ref == '")[1].slice(0, -1));
  assert(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ''), 'expected SHA required');
}
function prepare() {
  assertWindowsRunner(); validateBindings();
  const executionSha = checkoutSha(); assert.equal(executionSha, process.env.GITHUB_SHA);
  const system = systemEnvironment(process.env);
  assert(/^[a-z]:[\\/]/i.test(system.SystemRoot ?? ''), 'local-drive SystemRoot required');
  safeDirectory(dirname(scratch)); original.mkdirSync(scratch);
  const provenance = { format: 'windows-p1-initial-provenance-v1', executionSha, expectedSha: process.env.GITHUB_SHA,
    planningBase: BINDINGS.planning_base, timestampUtc: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), ref: process.env.GITHUB_REF,
    runtime: { node: process.version, uv: process.versions.uv, platform: process.platform, arch: process.arch,
      osRelease: release(), imageOS: process.env.ImageOS, imageVersion: process.env.ImageVersion },
    sourceFiles: sourceFiles(), environmentKeyNames: sorted([...Object.keys(system), ...BINDINGS.environment.synthetic_keys]),
    extraEnvironmentKeys: [], provenanceUnknown: false, releaseReady: false, releaseAcceptance: false };
  assert(validateProvenance(provenance, sourceFiles(), executionSha));
  writeJson(join(scratch, 'provenance.json'), 'provenance', provenance);
}
export function checksSummary(raw) {
  try {
    assert(raw && Array.isArray(raw.testResults) && raw.testResults.length === 1);
    const result = raw.testResults[0];
    assert(typeof result.name === 'string' && result.name.replaceAll('\\', '/').endsWith('/tests/diagnostics/windows-p1-stages.test.ts'));
    const assertions = result.assertionResults;
    assert(Array.isArray(assertions) && assertions.length > 0);
    assert(assertions.every(a => typeof a.fullName === 'string' && ['passed', 'failed', 'pending', 'skipped', 'todo'].includes(a.status)));
    const passed = assertions.filter(a => a.status === 'passed').length, failed = assertions.filter(a => a.status === 'failed').length;
    const skipped = assertions.length - passed - failed;
    assert(raw.numPassedTests === passed && raw.numFailedTests === failed && raw.numPendingTests === skipped && raw.numTotalTests === assertions.length);
    assert(typeof raw.success === 'boolean');
    const required = BINDINGS.required_future_controls.every(id => assertions.some(a => a.fullName.startsWith(id + ' ') && a.status === 'passed'));
    const all = raw.success && result.status === 'passed' && !failed && !skipped && required;
    return { format: 'windows-p1-initial-checks-v1', testPath: 'tests/diagnostics/windows-p1-stages.test.ts', exitCode: all ? 0 : 1,
      passed, failed, skipped, allRequiredControlsPassed: all, rawReportSuppressed: true, releaseAcceptance: false };
  } catch { return null; }
}
function readChecks() {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readOwned(join(scratch, 'checks.raw.json'), 4 * 1024 * 1024));
  const summary = checksSummary(JSON.parse(text)); assert(summary && rebuild('checksSummary', summary), 'checks outcome unavailable'); return summary;
}
function healthStates(directory, expected) {
  let complete = expected.length > 0, invalid = false;
  try {
    safeDirectory(directory);
    const files = original.readdirSync(directory);
    assert(files.length === expected.length && files.every(name => expected.some(p => name === p + '.json')));
    for (const p of expected) {
      const value = JSON.parse(readOwned(join(directory, p + '.json'), 1024));
      assert(exact(value, value.reasonCode === undefined ? ['pid', 'state'] : ['pid', 'state', 'reasonCode']));
      assert(value.pid === p && ['complete', 'pending', 'failed'].includes(value.state));
      assert(value.reasonCode === undefined || defs.safeCode.enum.includes(value.reasonCode));
      if (value.state !== 'complete' || value.reasonCode !== undefined) complete = false;
    }
  } catch { complete = false; invalid = true; }
  return { complete, invalid };
}
function expectedProcesses(guard, trace, rootPid) {
  try {
    assert(pid(rootPid));
    const expected = new Set([rootPid]), observed = new Set([rootPid]);
    for (const e of guard) {
      if (e.event === 'guard-preload') expected.add(e.pid);
      if (pid(e.childPid)) { observed.add(e.childPid); if (/^node(?:\.exe)?$/.test(e.executable ?? '')) expected.add(e.childPid); }
    }
    assert(expected.size <= 16 && observed.size <= 16);
    for (const p of expected) {
      const gp = guard.filter(e => e.pid === p && e.event === 'guard-preload');
      const tp = trace.filter(e => e.pid === p && e.event === 'preload');
      assert(gp.length === 1 && gp[0].oldTracePreloadOn === true && tp.length === 1);
    }
    assert(guard.every(e => expected.has(e.pid)) && trace.every(e => expected.has(e.pid)));
    return { expected: [...expected].sort((a, b) => a - b), observed: [...observed].sort((a, b) => a - b), unknown: false };
  } catch { return { expected: pid(rootPid) ? [rootPid] : [], observed: pid(rootPid) ? [rootPid] : [], unknown: true }; }
}
async function runRoot(c, root, env, caseDeadline, totalDeadline) {
  let child;
  try { child = cp.spawn(process.execPath, ['--import', 'tsx', self, '--probe', c.variant], { cwd: repo, env, windowsHide: true, shell: false }); }
  catch { return { root: null, probe: null }; }
  const initial = rootMetadata(child);
  return await new Promise(done => {
    let settled = false, stopped = false, stopReason = null, total = 0, outCount = 0, errCount = 0, launchCode = null;
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), streamUnknown = false;
    const stop = reason => {
      if (stopped) return; stopped = true; stopReason = reason;
      const m = rootMetadata(child);
      if (!m.unknown && m.pid && m.status === null && m.signal === null) {
        try { cp.spawnSync('taskkill.exe', ['/pid', String(m.pid), '/T', '/F'], { timeout: 1000, stdio: 'ignore', windowsHide: true, killSignal: 'SIGKILL' }); } catch { /* do not signal sampled history */ }
        try { child.kill('SIGKILL'); } catch { /* retained unknown */ }
      }
    };
    const finish = () => {
      if (settled) return; settled = true; clearTimeout(watchdog); clearTimeout(finalTimer);
      const metadata = rootMetadata(child), text = Buffer.concat([stdout, stderr]).toString('utf8');
      const rootRecord = { pid: initial.pid, status: metadata.status, signal: metadata.signal,
        metadataUnknown: initial.unknown || metadata.unknown || streamUnknown || initial.pid !== metadata.pid || launchCode === 'UNRECOGNIZED_ERROR_CODE',
        stopped, stopReason, launchCode, stdoutBytes: outCount, stderrBytes: errCount,
        outputBoundExceeded: total > BOUNDS.case_output_bytes, canaryFound: canary(text) };
      let probe = null;
      try { if (!rootRecord.canaryFound && total <= BOUNDS.case_output_bytes && !errCount) probe = parseProbeBytes(stdout); }
      catch { /* raw protocol is never a fallback */ }
      done({ root: rebuild('root', rootRecord), probe });
    };
    const remaining = Math.max(1, Math.min(BOUNDS.case_ms, Math.min(caseDeadline, totalDeadline) - Date.now()));
    const watchdog = setTimeout(() => stop('owned-case-watchdog-expired'), remaining);
    const finalTimer = setTimeout(() => { stop('owned-case-watchdog-expired'); child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); finish(); }, remaining + BOUNDS.cleanup_ms);
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      if (!stream) { streamUnknown = true; continue; }
      stream.on(errorMonitor, () => { streamUnknown = true; });
      stream.on('data', chunk => {
        if (!Buffer.isBuffer(chunk)) { streamUnknown = true; stop('diagnostic-output-limit-exceeded'); return; }
        const counts = countBytes({ stdoutBytes: outCount, stderrBytes: errCount, combinedBytes: total }, name, chunk.length, BOUNDS.case_output_bytes);
        total = counts.combinedBytes; outCount = counts.stdoutBytes; errCount = counts.stderrBytes;
        if (total > BOUNDS.case_output_bytes) { stop('diagnostic-output-limit-exceeded'); stdout = stderr = Buffer.alloc(0); return; }
        if (name === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
      });
    }
    child.on(errorMonitor, error => { launchCode = safeCode(error?.code) ?? 'LAUNCH_ERROR'; });
    child.on('error', finish); child.on('close', finish);
  });
}
async function runCase(c, runRoot, deadline, system) {
  const counter = join(runRoot, 'counter.jsonl');
  let before;
  try { before = counterState(readOwned(counter, BOUNDS.counter_bytes)); }
  catch { return unknownCase(c.variant, 'budget-admission-denied'); }
  if (!caseAdmission({ now: Date.now(), deadline, usedTotal: before.total, usedSmoke: before.smoke })) return skippedCase(c.variant, 'budget-admission-denied');
  const root = join(runRoot, c.caseId); original.mkdirSync(root);
  for (const dir of ['home', 'tmp', 'appdata', 'localappdata', 'guard-health', 'trace-health']) original.mkdirSync(join(root, dir));
  for (const file of ['guard.jsonl', 'trace.jsonl', 'home/empty-gitconfig']) original.writeFileSync(join(root, file), '', { flag: 'wx' });
  const latest = counterState(readOwned(counter, BOUNDS.counter_bytes));
  if (!caseAdmission({ now: Date.now(), deadline, usedTotal: latest.total, usedSmoke: latest.smoke })) {
    original.rmSync(root, { recursive: true }); return skippedCase(c.variant, 'budget-admission-denied');
  }
  const caseDeadline = Math.min(Date.now() + BOUNDS.case_ms, deadline - BOUNDS.cleanup_ms);
  const env = fixedEnvironment(system, root, runRoot, caseDeadline, deadline);
  original.writeFileSync(join(scratch, c.variant + '.started'), '', { flag: 'wx' });
  const ownedStarted = performance.now();
  const result = await runRoot(c, root, env, caseDeadline, deadline);
  const guard = readRows(join(root, 'guard.jsonl'), 'guard'), trace = readRows(join(root, 'trace.jsonl'), 'trace');
  const processes = expectedProcesses(guard.rows, trace.rows, result.root?.pid);
  const sample = () => processes.observed.filter(p => { try { process.kill(p, 0); return true; } catch { return false; } });
  const liveAtReturn = sample();
  if (liveAtReturn.length) await new Promise(done => setTimeout(done, Math.max(0, Math.min(
    BOUNDS.case_ms + BOUNDS.cleanup_ms - (performance.now() - ownedStarted), Math.min(caseDeadline + BOUNDS.cleanup_ms, deadline) - Date.now()))));
  const liveAfter = sample();
  const gh = healthStates(join(root, 'guard-health'), processes.expected), th = healthStates(join(root, 'trace-health'), processes.expected);
  const aborts = sorted([...guard.rows.filter(e => e.event === 'diagnostic-budget-abort').map(e => e.reason),
    ...(result.root?.stopped ? [result.root.stopReason] : []), ...(result.root?.status === 92 ? ['owned-lifetime-expired'] : [])]);
  const provenanceUnknown = guard.invalid || trace.invalid || !guard.rows.length || !trace.rows.length || processes.unknown || !gh.complete || !th.complete;
  const cleanupUnknown = Boolean(provenanceUnknown || liveAfter.length || !result.root || result.root.metadataUnknown || result.root.stopped || result.root.status === null || aborts.length);
  const health = { expectedPids: processes.expected, guardComplete: gh.complete, traceComplete: th.complete,
    guardInvalid: guard.invalid || gh.invalid, traceInvalid: trace.invalid || th.invalid, diagnosticAbortReasons: aborts,
    provenanceUnknown, cleanupUnknown, possibleLiveAtReturn: liveAtReturn, possibleLiveAfterOwnedCap: liveAfter,
    rootRetained: cleanupUnknown, historicalPidsSignalled: false, wholeTreeAbsenceProven: false };
  let after = null;
  try { after = counterState(readOwned(counter, BOUNDS.counter_bytes)); } catch { /* unknown remains null */ }
  const launches = after && after.total >= before.total && after.total - before.total <= 1 ? after.total - before.total : null;
  const record = evaluateCase({ variant: c.variant, probe: result.probe, root: result.root, health, guard: guard.rows, trace: trace.rows,
    launches, counterKnown: Boolean(after) });
  writeText(join(scratch, c.variant + '.guard.jsonl'), guard.invalid ? '' : guard.text);
  writeText(join(scratch, c.variant + '.trace.jsonl'), trace.invalid ? '' : trace.text);
  if (!record.health?.rootRetained) original.rmSync(root, { recursive: true });
  return record;
}
function retainedRoots(runRoot) {
  const retained = [];
  for (const c of CASES) {
    try { safeDirectory(join(runRoot, c.caseId)); retained.push(c.caseId); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return retained;
}
export function makeSummary(provenance, records, rows, exitCode, stopReason, counterKnown,
  retained = records.filter(r => r.health?.rootRetained).map(r => r.caseId)) {
  const sum = records.every(r => r.nativeLaunches !== null) ? records.reduce((n, r) => n + r.nativeLaunches, 0) : null;
  const known = Boolean(counterKnown && records.every(r => r.rootProcessStarted !== null) && sum !== null && sum === rows.length && sum <= 4);
  const complete = known && records.every(r => r.decision === 'skipped' || r.diagnostic_observation_complete) && records.some(r => r.decision === 'run') &&
    !['writer-control-not-complete', 'prior-observation-unknown', 'budget-admission-denied', 'synthetic-checks-not-passed', 'setup-or-outcome-unknown'].includes(stopReason);
  const summary = { format: 'windows-p1-initial-summary-v1', executionSha: provenance.executionSha, planningBase: BINDINGS.planning_base,
    variantOrder: CASES.map(c => c.variant), caseFiles: CASES.map(c => c.variant + '.case.json'), admissions: rows,
    totalNativeLaunches: known ? sum : null, smokeNativeLaunches: known ? sum : null,
    diagnosticExitCode: exitCode === null ? null : complete ? 0 : 1, diagnostic_observation_complete: complete, stopReason,
    retainedCases: retained, releaseReady: false, releaseAcceptance: false, formalF005Claim: false };
  assert(rebuild('summary', summary)); return summary;
}
async function runParent() {
  assertWindowsRunner(); validateBindings();
  const provenance = readJson(join(scratch, 'provenance.json'), 'provenance');
  assert(validateProvenance(provenance, sourceFiles(), checkoutSha()));
  original.writeFileSync(join(scratch, 'run.started'), '', { flag: 'wx' });
  const checks = readChecks();
  if (!checks.allRequiredControlsPassed) {
    const records = CASES.map(c => skippedCase(c.variant, 'synthetic-checks-not-passed'));
    for (const r of records) writeJson(join(scratch, r.variant + '.case.json'), 'caseRecord', r);
    writeJson(join(scratch, 'summary.json'), 'summary', makeSummary(provenance, records, [], 1, 'synthetic-checks-not-passed', false));
    process.exitCode = 1; return;
  }
  const runRoot = join(scratch, 'run-root'); original.mkdirSync(runRoot);
  const counter = join(runRoot, 'counter.jsonl'); original.writeFileSync(counter, '', { flag: 'wx' });
  const deadline = Date.now() + BOUNDS.total_ms, system = systemEnvironment(process.env), records = [];
  let next = 'run-T0', stopReason = null;
  for (const c of CASES) {
    let record;
    if (next === 'run-' + c.variant) {
      try { record = await runCase(c, runRoot, deadline, system); }
      catch { record = unknownCase(c.variant); }
      const chosen = record.decision === 'skipped' ? { action: 'stop-unknown', reason: record.reason } : selection(record);
      next = chosen.action; stopReason = chosen.reason;
    } else record = skippedCase(c.variant, stopReason ?? 'prior-observation-unknown');
    records.push(record); writeJson(join(scratch, c.variant + '.case.json'), 'caseRecord', record);
  }
  const parsed = readRows(counter, 'counter');
  let counterKnown = !parsed.invalid;
  try { counterState(readOwned(counter, BOUNDS.counter_bytes)); } catch { counterKnown = false; }
  const summary = makeSummary(provenance, records, parsed.invalid ? [] : parsed.rows, 1, stopReason, counterKnown, retainedRoots(runRoot));
  if (counterKnown) writeText(join(scratch, 'counter.jsonl'), parsed.text, BOUNDS.counter_bytes);
  writeJson(join(scratch, 'summary.json'), 'summary', summary);
  if (!summary.retainedCases.length) original.rmSync(runRoot, { recursive: true });
  process.exitCode = summary.diagnosticExitCode;
}

export function validateCaseRecord(value, guardRows, traceRows, counterKnown) {
  const v = rebuild('caseRecord', value);
  if (!v) return false;
  const c = caseFor(v.variant);
  if (v.caseId !== c.caseId || v.scriptSha256 !== c.scriptSha256 || !same(v.markers, c.sequence.slice(0, v.markers.length)) ||
    !same(v.notObserved, c.sequence.slice(v.markers.length))) return false;
  if (v.decision === 'skipped') return same(v, skippedCase(v.variant, v.reason)) && !guardRows.length && !traceRows.length;
  if (!v.root && !v.health) return same(v, unknownCase(v.variant, v.reason)) && !v.diagnostic_observation_complete;
  if (!v.health || v.rootProcessStarted !== (v.root?.pid ? true : null) ||
    (v.root && v.root.stdoutBytes + v.root.stderrBytes > BOUNDS.case_output_bytes && !v.root.outputBoundExceeded)) return false;
  const processes = expectedProcesses(guardRows, traceRows, v.root?.pid);
  if (!processes.unknown && !same(processes.expected, v.health.expectedPids)) return false;
  const fakeProbe = { format: 'windows-p1-initial-probe-v1', variant: c.variant, caseId: c.caseId, scriptSha256: c.scriptSha256,
    probeSetupComplete: true, native: v.native, releaseAcceptance: false };
  const derived = evaluateCase({ variant: c.variant, probe: fakeProbe, root: v.root, health: v.health,
    guard: guardRows, trace: traceRows, launches: v.nativeLaunches, counterKnown });
  return same(v, derived);
}
export function validateSequence(records) {
  if (records.length !== 4 || !same(records.map(r => r.variant), CASES.map(c => c.variant))) return false;
  let next = 'run-T0', reason = null;
  for (const record of records) {
    if (next === 'run-' + record.variant) {
      if (record.decision === 'skipped') {
        if (!['budget-admission-denied', 'synthetic-checks-not-passed'].includes(record.reason)) return false;
        next = 'stop-unknown'; reason = record.reason;
      } else {
        const selected = selection(record); next = selected.action; reason = selected.reason;
      }
    } else if (record.decision !== 'skipped' || record.reason !== (reason ?? 'prior-observation-unknown')) return false;
  }
  return true;
}
function loadCaseEvidence(base, variant, absentUnknown = false) {
  const path = join(base, variant + '.case.json');
  let record;
  try { original.lstatSync(path); record = readJson(path, 'caseRecord'); }
  catch (error) {
    if (!absentUnknown || error?.code !== 'ENOENT') throw error;
    record = unknownCase(variant);
  }
  const guard = readRows(join(base, variant + '.guard.jsonl'), 'guard'), trace = readRows(join(base, variant + '.trace.jsonl'), 'trace');
  if (record.decision === 'skipped') {
    if (!guard.invalid) assert.equal(guard.rows.length, 0);
    if (!trace.invalid) assert.equal(trace.rows.length, 0);
    return { record, guard: { rows: [], text: '', invalid: false }, trace: { rows: [], text: '', invalid: false } };
  }
  if (record.root && record.health && (guard.invalid || trace.invalid)) {
    record.health.guardInvalid ||= guard.invalid; record.health.traceInvalid ||= trace.invalid;
    if (guard.invalid) record.health.guardComplete = false;
    if (trace.invalid) record.health.traceComplete = false;
    record.health.provenanceUnknown = true; record.health.cleanupUnknown = true; record.health.rootRetained = true;
    record.diagnostic_observation_complete = false; record.native_completed = false;
    const probe = { format: 'windows-p1-initial-probe-v1', variant, caseId: record.caseId, scriptSha256: record.scriptSha256,
      probeSetupComplete: true, native: record.native, releaseAcceptance: false };
    record = evaluateCase({ variant, probe, root: record.root, health: record.health, guard: guard.rows, trace: trace.rows,
      launches: record.nativeLaunches, counterKnown: false });
  }
  return { record, guard, trace };
}
function seal() {
  assertWindowsRunner(); validateBindings();
  const provenance = readJson(join(scratch, 'provenance.json'), 'provenance'), checks = readChecks();
  assert(validateProvenance(provenance, sourceFiles(), checkoutSha()));
  const evidence = CASES.map(c => loadCaseEvidence(scratch, c.variant, true));
  let counterPath = join(scratch, 'run-root/counter.jsonl');
  try { original.lstatSync(counterPath); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; counterPath = join(scratch, 'counter.jsonl'); }
  const counter = readRows(counterPath, 'counter');
  let counterKnown = !counter.invalid;
  try { counterState(readOwned(counterPath, BOUNDS.counter_bytes)); } catch { counterKnown = false; }
  for (const e of evidence) assert(validateCaseRecord(e.record, e.guard.rows, e.trace.rows, counterKnown));
  const records = evidence.map(e => e.record);
  let oldSummary = null;
  try { original.lstatSync(join(scratch, 'summary.json')); oldSummary = readJson(join(scratch, 'summary.json'), 'summary'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const missing = records.some(r => r.rootProcessStarted === null || r.nativeLaunches === null);
  if (!missing) assert(validateSequence(records), 'selection sequence');
  else assert(records.every(r => !r.diagnostic_observation_complete || r.rootProcessStarted === true), 'unknown outcome');
  let stopReason = missing ? 'setup-or-outcome-unknown' : oldSummary?.stopReason ?? 'setup-or-outcome-unknown';
  const summary = makeSummary(provenance, records, counter.invalid ? [] : counter.rows, oldSummary?.diagnosticExitCode ?? null, stopReason, counterKnown,
    retainedRoots(join(scratch, 'run-root')));
  if (!missing && oldSummary) assert(same(summary, oldSummary), 'summary reconstruction');
  safeDirectory(dirname(upload)); original.mkdirSync(upload);
  writeJson(join(upload, 'provenance.json'), 'provenance', provenance);
  writeJson(join(upload, 'checks-summary.json'), 'checksSummary', checks);
  writeJson(join(upload, 'summary.json'), 'summary', summary);
  for (const { record, guard, trace } of evidence) {
    writeJson(join(upload, record.variant + '.case.json'), 'caseRecord', record);
    writeText(join(upload, record.variant + '.guard.jsonl'), guard.invalid ? '' : guard.text);
    writeText(join(upload, record.variant + '.trace.jsonl'), trace.invalid ? '' : trace.text);
  }
  const files = BINDINGS.output.upload_files.filter(p => p !== 'manifest.json').sort().map(path => {
    const bytes = readOwned(join(upload, path), path.endsWith('.jsonl') ? BOUNDS.guard_bytes : BINDINGS.output.json_max_bytes);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  writeJson(join(upload, 'manifest.json'), 'manifest', { format: 'windows-p1-initial-manifest-v1', executionSha: provenance.executionSha, files, releaseAcceptance: false });
  verifyUpload();
}
export function verifySealedDirectory(directory, files, executionSha) {
  safeDirectory(directory);
  assert.deepEqual(original.readdirSync(directory).sort(), [...BINDINGS.output.upload_files].sort(), 'exact sealed file set');
  const provenance = readJson(join(directory, 'provenance.json'), 'provenance'), checks = readJson(join(directory, 'checks-summary.json'), 'checksSummary');
  assert(validateProvenance(provenance, files, executionSha));
  assert(checks.allRequiredControlsPassed === (checks.exitCode === 0 && checks.failed === 0 && checks.skipped === 0 && checks.passed > 0));
  const summary = readJson(join(directory, 'summary.json'), 'summary'), manifest = readJson(join(directory, 'manifest.json'), 'manifest');
  assert(summary.executionSha === executionSha && manifest.executionSha === executionSha);
  assert.deepEqual(manifest.files.map(f => f.path), BINDINGS.output.upload_files.filter(p => p !== 'manifest.json').sort());
  for (const entry of manifest.files) {
    const bytes = readOwned(join(directory, entry.path), entry.path.endsWith('.jsonl') ? BOUNDS.guard_bytes : BINDINGS.output.json_max_bytes);
    assert(entry.bytes === bytes.length && entry.sha256 === sha256(bytes), 'sealed digest');
  }
  const evidence = CASES.map(c => loadCaseEvidence(directory, c.variant));
  assert(evidence.every(e => !e.guard.invalid && !e.trace.invalid), 'public streams must be canonical');
  const records = evidence.map(e => e.record), known = summary.totalNativeLaunches !== null;
  for (const e of evidence) assert(validateCaseRecord(e.record, e.guard.rows, e.trace.rows, known));
  const missing = records.some(r => r.rootProcessStarted === null || r.nativeLaunches === null);
  if (!missing) assert(validateSequence(records));
  else assert(summary.stopReason === 'setup-or-outcome-unknown' && !summary.diagnostic_observation_complete && summary.totalNativeLaunches === null);
  for (const row of summary.admissions) assert(evidenceEvent('counter', row));
  for (const r of records) if (r.health?.rootRetained) assert(summary.retainedCases.includes(r.caseId));
  for (const id of summary.retainedCases) {
    const r = records.find(r => r.caseId === id);
    assert(r && (r.health?.rootRetained || r.rootProcessStarted === null), 'retained root source');
  }
  assert(same(summary, makeSummary(provenance, records, summary.admissions, summary.diagnosticExitCode, summary.stopReason, known, summary.retainedCases)));
  if (summary.diagnostic_observation_complete) assert(checks.allRequiredControlsPassed);
  return true;
}
function verifyUpload() {
  assertWindowsRunner(); validateBindings();
  const files = sourceFiles(), executionSha = checkoutSha();
  assert.equal(executionSha, process.env.GITHUB_SHA);
  return verifySealedDirectory(upload, files, executionSha);
}

if (new URL(import.meta.url).searchParams.get('guard') === '1') installGuard();
else if (process.argv[1] && resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  try {
    if (same(args, ['--prepare'])) prepare();
    else if (same(args, ['--run'])) await runParent();
    else if (args.length === 2 && args[0] === '--probe' && CASES.some(c => c.variant === args[1])) { assertWindowsRunnerForProbe(); await runProbe(args[1]); }
    else if (same(args, ['--seal'])) seal();
    else if (same(args, ['--verify-upload'])) verifyUpload();
    else throw new Error('fixed CLI mode required');
  } catch {
    if (args.length === 2 && args[0] === '--probe' && CASES.some(c => c.variant === args[1])) {
      const c = caseFor(args[1]);
      process.stdout.write(JSON.stringify({ format: 'windows-p1-initial-probe-v1', variant: c.variant, caseId: c.caseId,
        scriptSha256: c.scriptSha256, probeSetupComplete: false, native: unknownNative(), releaseAcceptance: false }) + '\n');
    } else process.stderr.write('windows-p1-initial diagnostic evidence unavailable\n');
    process.exitCode = 1;
  }
}
function assertWindowsRunnerForProbe() {
  assert(process.platform === 'win32' && process.arch === 'x64' && /^v22\./.test(process.version));
}
