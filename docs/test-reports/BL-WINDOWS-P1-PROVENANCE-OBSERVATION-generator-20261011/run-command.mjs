import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const reports = dirname(fileURLToPath(import.meta.url));
const root = resolve(reports, '../../..');
const [id, command, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(id ?? '') || !command) throw new Error('command identity required');
const home = '/Volumes/ORICO/project/.wp1provog-20261011';
for (const part of ['', 'tmp', 'npmcache']) fs.mkdirSync(join(home, part), { recursive: true });
const env = {
  PATH: '/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:/usr/sbin:/sbin:/usr/bin:/bin',
  HOME: home, USERPROFILE: home, TMPDIR: join(home, 'tmp'), TMP: join(home, 'tmp'), TEMP: join(home, 'tmp'),
  npm_config_cache: join(home, 'npmcache'), npm_config_registry: 'https://registry.npmjs.org',
  npm_config_userconfig: join(home, '.npmrc'), npm_config_globalconfig: join(home, 'empty-global-npmrc')
};
const files = Object.fromEntries(['stdout', 'stderr', 'raw'].map(stream => [stream, fs.openSync(join(reports, id + '.' + stream + '.log'), 'wx')]));
const started = new Date().toISOString();
const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
  fs.writeSync(files[stream], bytes); fs.writeSync(files.raw, bytes); process[stream].write(bytes);
});
child.on('error', error => {
  const bytes = Buffer.from(String(error) + '\n'); fs.writeSync(files.stderr, bytes); fs.writeSync(files.raw, bytes); process.stderr.write(bytes);
});
child.on('close', (status, signal) => {
  for (const fd of Object.values(files)) fs.closeSync(fd);
  const result = { id, command, args, cwd: root, env, started, ended: new Date().toISOString(), status, signal };
  fs.writeFileSync(join(reports, id + '.result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  const ledgerPath = join(reports, 'command-ledger.json');
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : [];
  ledger.push(result); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  process.exitCode = status ?? 1;
});
