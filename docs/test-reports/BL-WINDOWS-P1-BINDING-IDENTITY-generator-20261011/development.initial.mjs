import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-binding-identity-generator-20261011';
const report = join(repo, 'docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-generator-20261011');
const own = '/Volumes/ORICO/project/.wp1cbg-20261011';
const node = '/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node';
const npm = '/Users/yixingzhou/.nvm/versions/node/v22.22.0/lib/node_modules/npm/bin/npm-cli.js';
const source = '61cf64e67a6fda231bb090e77c19d5ececb908af';
assert.equal(resolve('.'), repo);
assert.equal(process.env.HOME, own);
assert.equal(process.env.USERPROFILE, own);
assert.equal(process.execPath, node);
const env = {
  HOME: own, USERPROFILE: own, TMPDIR: own + '/tmp/', TEMP: own + '/tmp/', TMP: own + '/tmp/',
  PATH: '/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:/usr/sbin:/sbin:/usr/bin:/bin',
  XDG_CACHE_HOME: own + '/cache', XDG_CONFIG_HOME: own + '/config', XDG_DATA_HOME: own + '/data',
  NPM_CONFIG_CACHE: own + '/cache/npm', NPM_CONFIG_USERCONFIG: own + '/config/npmrc',
  NPM_CONFIG_GLOBALCONFIG: own + '/config/npmrc-global', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: own + '/config/gitconfig',
  NEXT_TELEMETRY_DISABLED: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', TZ: 'UTC', LANG: 'en_US.UTF-8'
};
const sha = b => createHash('sha256').update(b).digest('hex');
const file = path => { const b = fs.readFileSync(path); return { path: path.startsWith(report + '/') ? path.slice(report.length + 1) : path,
  bytes: b.length, sha256: sha(b) }; };
function json(path, value) { fs.writeFileSync(join(report, path), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
const results = [];
const state = { format: 'windows-p1-C002-owned-generator-development-v1', source,
  observed_at_utc: new Date().toISOString(), cwd: repo, role: 'supporting Generator development; not independent acceptance',
  env, inherited_ambient_env: false, reused_dependencies: false, install_attempts: 0,
  native_diagnostic_modes_authorized_or_executed: false, publication_or_push: false,
  lifecycle_network_limit: 'Only public registry and unchanged package-owned Prisma/better-sqlite3 lifecycle endpoints authorized; no full egress isolation or host-observation claim',
  commands: results };
async function run(label, args, executable = node) {
  const outPath = join(report, `${label}.stdout.log`), errPath = join(report, `${label}.stderr.log`);
  const out = fs.openSync(outPath, 'wx'), err = fs.openSync(errPath, 'wx');
  const start = new Date().toISOString();
  let spawnError = null;
  console.log(JSON.stringify({ event: 'start', label, executable, args }));
  const status = await new Promise(resolve => {
    const child = cp.spawn(executable, args, { cwd: repo, env, stdio: ['ignore', out, err], shell: false });
    child.on('error', error => { spawnError = { code: error.code, message: error.message }; });
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  fs.closeSync(out); fs.closeSync(err);
  const r = { label, executable, args, cwd: repo, env_metadata: 'development.raw.json#/env',
    started_at_utc: start, finished_at_utc: new Date().toISOString(), status: status.code,
    signal: status.signal, spawn_error: spawnError, stdout: file(outPath), stderr: file(errPath) };
  results.push(r);
  json(`${label}.status.json`, r);
  console.log(JSON.stringify({ event: 'complete', label, status: r.status, signal: r.signal,
    stdout_bytes: r.stdout.bytes, stderr_bytes: r.stderr.bytes }));
  return r;
}
try {
  assert(!fs.existsSync(join(repo, 'node_modules')), 'fresh npm ci requires absent dependency root');
  assert(!fs.existsSync(join(report, 'development.raw.json')));
  const lockBytes = fs.readFileSync(join(repo, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  state.before = { node_modules_absent: true, package_lock: file(join(repo, 'package-lock.json')),
    package_json: file(join(repo, 'package.json')), home_exists: fs.statSync(own).isDirectory(),
    tmp_realpath: fs.realpathSync(env.TMPDIR), npm_cache_absent: !fs.existsSync(env.NPM_CONFIG_CACHE) };
  state.locked_lifecycle_packages = Object.entries(lock.packages).filter(([, p]) => p.hasInstallScript)
    .map(([path, p]) => ({ path, version: p.version, resolved: p.resolved, integrity: p.integrity }));
  for (const [, p] of Object.entries(lock.packages)) if (p.resolved && !p.resolved.startsWith('file:'))
    assert(p.resolved.startsWith('https://registry.npmjs.org/'), 'non-public-registry locked package');
  assert.equal((await run('01-node-version', ['--version'])).status, 0);
  assert.equal((await run('02-npm-version', [npm, '--version'])).status, 0);
  state.install_attempts++;
  const install = await run('03-npm-ci', [npm, 'ci', '--foreground-scripts']);
  assert.equal(install.status, 0, 'do not rerun or expand dependencies after npm ci failure');
  assert.equal(install.signal, null);
  assert(!fs.lstatSync(join(repo, 'node_modules')).isSymbolicLink(), 'owned installed root, not symlink dependencies');
  assert(lockBytes.equals(fs.readFileSync(join(repo, 'package-lock.json'))), 'lockfile unchanged');
  const references = [];
  const refPaths = [
    'node_modules/@prisma/fetch-engine/dist/chunk-MX3HXAU2.js',
    'node_modules/@prisma/fetch-engine/dist/chunk-MLIGY6OH.js',
    'node_modules/@prisma/fetch-engine/dist/chunk-QGM4M3NI.js',
    'node_modules/better-sqlite3/package.json',
    'node_modules/prebuild-install/download.js',
    'node_modules/prebuild-install/util.js'
  ];
  for (const path of refPaths) if (fs.existsSync(join(repo, path))) {
    const text = fs.readFileSync(join(repo, path), 'utf8');
    const lines = text.split('\n').flatMap((line, index) =>
      /binaries\.prisma\.sh|WiseLibs|prebuild-install|github\.com|release|npm_config_download/.test(line)
        ? [{ line: index + 1, text: line.slice(0, 2000) }] : []);
    references.push({ ...file(join(repo, path)), lines });
  }
  const fetchRoot = join(repo, 'node_modules/@prisma/fetch-engine/dist');
  if (fs.existsSync(fetchRoot)) for (const name of fs.readdirSync(fetchRoot).filter(n => n.endsWith('.js'))) {
    const path = join(fetchRoot, name), text = fs.readFileSync(path, 'utf8');
    if (text.includes('binaries.prisma.sh') && !references.some(r => r.path === path))
      references.push({ ...file(path), lines: text.split('\n').flatMap((line, index) =>
        line.includes('binaries.prisma.sh') ? [{ line: index + 1, text: line.slice(0, 2000) }] : []) });
  }
  json('04-package-lifecycle-references.json', { classification: 'installed unchanged package source references; not actual host/egress capture', references });
  await run('05-syntax', ['--check', 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs']);
  await run('06-pure-import', ['docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-generator-20261011/pure-import.mjs']);
  const rawTests = join(report, '07-original81.raw.json');
  assert(!fs.existsSync(rawTests));
  await run('07-original81', ['node_modules/vitest/vitest.mjs', 'run', 'tests/diagnostics/windows-p1-stages.test.ts',
    '--reporter=json', `--outputFile=${rawTests}`]);
  if (fs.existsSync(rawTests)) {
    const tests = JSON.parse(fs.readFileSync(rawTests));
    state.original81 = { ...file(rawTests), numTotalTests: tests.numTotalTests,
      numPassedTests: tests.numPassedTests, numFailedTests: tests.numFailedTests,
      numPendingTests: tests.numPendingTests, numTodoTests: tests.numTodoTests,
      success: tests.success, unchanged_source_sha256: file(join(repo, 'tests/diagnostics/windows-p1-stages.test.ts')).sha256,
      checkout_five_key_confinement_coverage_claimed: false };
  }
  await run('08-verify', [npm, 'run', 'verify']);
  state.after = { package_lock: file(join(repo, 'package-lock.json')), package_json: file(join(repo, 'package.json')),
    dependency_root_is_owned_regular_directory: fs.lstatSync(join(repo, 'node_modules')).isDirectory(),
    node_modules_realpath: fs.realpathSync(join(repo, 'node_modules')) };
  state.ok = results.every(r => r.status === 0 && r.signal === null && !r.spawn_error);
  if (!state.ok) process.exitCode = 1;
} catch (error) {
  state.ok = false;
  state.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  state.finished_at_utc = new Date().toISOString();
  json('development.raw.json', state);
  console.log(JSON.stringify({ event: 'finished', ok: state.ok, source, install_attempts: state.install_attempts,
    original81: state.original81, failure: state.failure }));
}
