import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const report = fileURLToPath(new URL('.', import.meta.url));
const home = '/Volumes/ORICO/project/.wp1cg-20261011';
const nodeBin = '/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin';
const [id, command, ...args] = process.argv.slice(2);
assert(/^[0-9]{2}-[a-z0-9-]+$/.test(id), 'immutable unique capture id');
assert(command && !args.some(a => /^--(?:prepare|run|probe|seal|verify-upload)$/.test(a)), 'no diagnostic CLI execution');
if (command === 'git') assert.deepEqual(args.slice(0, 2), ['-c', 'core.fileMode=false']);
const output = /^9[7-9]-/.test(id) ? join(home, 'final-evidence') : join(report, 'raw');
for (const path of [home, join(home, 'tmp'), join(home, 'npm-cache'), output]) fs.mkdirSync(path, { recursive: true });
const env = {
  HOME: home, USERPROFILE: home, TMPDIR: join(home, 'tmp'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
  PATH: `${nodeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
  NPM_CONFIG_CACHE: join(home, 'npm-cache'), NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
  NPM_CONFIG_USERCONFIG: join(home, 'absent-npmrc'), CI: 'true', LANG: 'C', TZ: 'UTC',
};
const prefix = join(output, id);
const out = fs.openSync(prefix + '.stdout.log', 'wx');
const err = fs.openSync(prefix + '.stderr.log', 'wx');
const merged = fs.openSync(prefix + '.combined.log', 'wx');
const startedAt = new Date().toISOString();
fs.writeFileSync(prefix + '.command.json', JSON.stringify({ command, args, cwd: repo, env, startedAt }, null, 2) + '\n', { flag: 'wx' });
const child = spawn(command, args, { cwd: repo, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
let error = null;
child.on('error', e => { error = { name: e.name, message: e.message, code: e.code ?? null }; });
child.stdout.on('data', b => { fs.writeSync(out, b); fs.writeSync(merged, b); });
child.stderr.on('data', b => { fs.writeSync(err, b); fs.writeSync(merged, b); });
const status = await new Promise(done => child.on('close', (code, signal) => done({ code, signal })));
for (const fd of [out, err, merged]) fs.closeSync(fd);
fs.writeFileSync(prefix + '.status.json', JSON.stringify({ startedAt, completedAt: new Date().toISOString(), ...status, error }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ id, ...status, error, stdoutBytes: fs.statSync(prefix + '.stdout.log').size, stderrBytes: fs.statSync(prefix + '.stderr.log').size }));
process.exitCode = status.code ?? 1;
