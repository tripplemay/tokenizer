import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const own = '/Volumes/ORICO/project/.wp1cbg-20261011';
assert.equal(process.env.HOME, own);
assert.equal(process.env.USERPROFILE, own);
assert.equal(process.env.TMPDIR, own + '/tmp/');
const restored = [];
const forbiddenCalls = [];
const methods = [
  [cp, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
  [fs, ['mkdirSync', 'rmdirSync', 'rmSync', 'writeFileSync', 'appendFileSync', 'writeSync',
    'unlinkSync', 'renameSync', 'copyFileSync', 'symlinkSync', 'linkSync', 'truncateSync']]
];
try {
  for (const [object, keys] of methods) for (const key of keys) {
    const before = object[key];
    const guard = () => { forbiddenCalls.push(key); throw new Error(`pure import forbids ${key}`); };
    object[key] = guard;
    restored.push({ object, key, before, guard });
  }
  syncBuiltinESMExports();
  const target = pathToFileURL(resolve('docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs'));
  assert(!target.searchParams.has('guard'));
  const m = await import(target.href);
  assert.equal(m.BINDINGS.revision, 3);
  assert.equal(m.CASES.length, 4);
  assert.equal(m.validateBindings(), true);
  for (const { object, key, guard } of restored) assert.equal(object[key], guard, `no installed wrapper: ${key}`);
  assert.deepEqual(forbiddenCalls, []);
  console.log(JSON.stringify({ kind: 'pure-import-and-validateBindings', ok: true,
    revision: m.BINDINGS.revision, cases: m.CASES.map(c => c.variant),
    forbidden_calls: forbiddenCalls, diagnostic_modes_executed: false,
    native_or_live_process_operations: false, independent_acceptance: false }));
} finally {
  for (const { object, key, before } of restored) object[key] = before;
  syncBuiltinESMExports();
}
