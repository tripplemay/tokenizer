import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { basename, relative, isAbsolute } from 'node:path';

const append = fs.appendFileSync;
const root = process.env.TW_ROOT;
const trace = process.env.TW_TRACE;
if (!root || !trace || !trace.startsWith(root)) throw new Error('synthetic trace root required');
let sequence = 0;
const log = (event) => {
  if (fs.existsSync(trace) && fs.statSync(trace).size >= 512 * 1024) return;
  append(trace, JSON.stringify({ pid: process.pid, sequence: sequence++,
    at: Date.now(), monotonicMs: performance.now(), ...event }) + '\n');
};
const label = (value) => {
  if (typeof value !== 'string') return typeof value;
  const rel = relative(root, value);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? '$OWNED/' + rel : value === root ? '$OWNED' : '$ANCESTOR_OR_OTHER';
};
for (const name of ['lstatSync', 'fstatSync', 'openSync', 'renameSync', 'mkdirSync', 'linkSync']) {
  const original = fs[name];
  fs[name] = function (...args) {
    const started = performance.now();
    try {
      const result = original.apply(this, args);
      log({ event: 'fs', operation: name, target: label(args[0]), ok: true, elapsedMs: performance.now() - started,
        ...(result?.isDirectory ? { directory: result.isDirectory(), file: result.isFile(), symlink: result.isSymbolicLink(),
          dev: String(result.dev), ino: String(result.ino) } : {}) });
      return result;
    } catch (error) {
      log({ event: 'fs', operation: name, target: label(args[0]), ok: false, code: error.code ?? null,
        syscall: error.syscall ?? null, elapsedMs: performance.now() - started });
      throw error;
    }
  };
}
const native = fs.realpathSync.native;
fs.realpathSync.native = function (...args) {
  try { const result = native.apply(this, args); log({ event: 'realpath-native', target: label(args[0]), ok: true }); return result; }
  catch (error) { log({ event: 'realpath-native', target: label(args[0]), ok: false, code: error.code ?? null }); throw error; }
};
const spawn = cp.spawn;
cp.spawn = function (command, args, options) {
  const child = spawn.call(this, command, args, options);
  const executable = basename(String(command));
  log({ event: 'spawn', executable, childPid: child.pid ?? null, detached: options?.detached ?? false });
  child.on('error', (error) => log({ event: 'child-error', executable, childPid: child.pid ?? null, code: error.code ?? null }));
  child.on('exit', (status, signal) => log({ event: 'child-exit', executable, childPid: child.pid, status, signal }));
  child.on('close', (status, signal) => log({ event: 'child-close', executable, childPid: child.pid, status, signal }));
  child.stdout?.on('data', (chunk) => log({ event: 'stdout-bytes', childPid: child.pid, bytes: chunk.length }));
  child.stderr?.on('data', (chunk) => log({ event: 'stderr-bytes', childPid: child.pid, bytes: chunk.length }));
  return child;
};
const spawnSync = cp.spawnSync;
cp.spawnSync = function (command, args, options) {
  const started = performance.now();
  const result = spawnSync.call(this, command, args, options);
  let workerKind = null;
  if (String(command) === process.execPath && Array.isArray(args) && args[0]?.endsWith('bounded-subprocess-worker.mjs')) {
    try { workerKind = JSON.parse(String(result.stdout).split('\n')[1]).kind; } catch { /* protocol failure is retained as null */ }
  }
  log({ event: 'spawn-sync', executable: basename(String(command)), elapsedMs: performance.now() - started,
    status: result.status, signal: result.signal, code: result.error?.code ?? null, workerKind });
  return result;
};
syncBuiltinESMExports();
log({ event: 'preload', node: process.version, uv: process.versions.uv });
