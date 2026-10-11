import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';

const calls = [];
const saved = [];
const block = (object, key, family) => {
  saved.push([object, key, object[key]]);
  object[key] = () => { calls.push(`${family}.${key}`); throw new Error(`unexpected import side effect: ${family}.${key}`); };
};
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) block(cp, key, 'child_process');
for (const key of ['appendFileSync', 'mkdirSync', 'mkdtempSync', 'writeFileSync', 'writeSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync']) block(fs, key, 'fs');
block(process, 'kill', 'process');
syncBuiltinESMExports();
let module;
try {
  module = await import('../windows-p1-stages-20261010/p1-stages.mjs?generator-pure-import=1');
  assert.equal(module.CASES.length, 4);
  assert.equal(module.validateBindings(), true);
  assert.deepEqual(calls, []);
  const env = module.systemEnvironment({ Path: 'owned-path', systemroot: 'owned-system-root', windir: 'owned-windir',
    comspec: 'owned-comspec', pathext: '.EXE', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.longpaths', GIT_CONFIG_VALUE_0: 'true' });
  assert.deepEqual(Object.keys(env), ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']);
  assert.throws(() => module.systemEnvironment({ Path: 'one', PATH: 'two' }));
  console.log(JSON.stringify({ pureImport: true, calls, validateBindings: true, cases: 4,
    checkoutConfigKeysInSystemEnvironment: [], survivingSystemKeys: Object.keys(env),
    functionalOrNativeAcceptance: false }, null, 2));
} finally {
  for (const [object, key, original] of saved) object[key] = original;
  syncBuiltinESMExports();
}
