import { spawnSync } from 'node:child_process';
import { openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [name, command, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name ?? '') || !command) throw new Error('name and command required');
const root = resolve('docs/test-reports/BL-RELEASE-READINESS-generator-20261008');
const fd = openSync(`${root}/${name}.log`, 'wx');
const started = new Date().toISOString();
const result = spawnSync(command, args, {
  env: {
    ...process.env,
    PATH: `/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:${process.env.PATH}`,
    HOME: '/private/tmp/tkrg.BIlgHB/h',
    USERPROFILE: '/private/tmp/tkrg.BIlgHB/h',
    TMPDIR: '/private/tmp/tkrg.BIlgHB/t',
    DATABASE_URL: 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
    NEXT_TELEMETRY_DISABLED: '1'
  },
  stdio: ['ignore', fd, fd],
  timeout: 1_800_000
});
closeSync(fd);
const record = { name, command, args, cwd: process.cwd(), started, finished: new Date().toISOString(),
  node: '/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node',
  home: '/private/tmp/tkrg.BIlgHB/h', tmpdir: '/private/tmp/tkrg.BIlgHB/t',
  status: result.status, signal: result.signal, error: result.error?.message ?? null };
writeFileSync(`${root}/${name}.json`, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(record));
process.exitCode = result.status ?? 1;
