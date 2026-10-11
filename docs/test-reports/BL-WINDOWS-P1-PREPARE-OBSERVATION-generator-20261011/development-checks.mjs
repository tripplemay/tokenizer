import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-prepare-observation-generator-20261011';
const report = join(repo, 'docs/test-reports/BL-WINDOWS-P1-PREPARE-OBSERVATION-generator-20261011');
const home = '/Volumes/ORICO/project/.wp1pog-20261011';
const bin = '/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin';
const node = join(bin, 'node'), npm = join(bin, 'npm');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const env = {
  HOME: home, USERPROFILE: home, TMPDIR: join(home, 'tmp'),
  PATH: bin + ':/usr/bin:/bin:/usr/sbin:/sbin',
  npm_config_cache: join(home, 'npm-cache'), npm_config_registry: 'https://registry.npmjs.org/'
};
assert.equal(process.version, 'v22.22.0'); assert.equal(process.cwd(), repo);
assert(!fs.existsSync(home), 'owned home must be fresh; no reuse/reinstall');
assert(!fs.existsSync(join(repo, 'node_modules')), 'owned dependencies must not preexist');
fs.mkdirSync(join(home, 'tmp'), { recursive: true });
fs.mkdirSync(join(home, 'npm-cache'));
const results = [];
const run = (name, executable, args, timeout = 600000) => {
  const stdoutPath = join(report, name + '.stdout.log'), stderrPath = join(report, name + '.stderr.log');
  const stdout = fs.openSync(stdoutPath, 'wx'), stderr = fs.openSync(stderrPath, 'wx');
  const started = new Date().toISOString();
  let result;
  try { result = cp.spawnSync(executable, args, { cwd: repo, env, stdio: ['ignore', stdout, stderr], timeout }); }
  finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  const record = {
    name, executable, args, cwd: repo, env, started_utc: started, ended_utc: new Date().toISOString(),
    status: result.status, signal: result.signal, launch_error: result.error ? { name: result.error.name, code: result.error.code, message: result.error.message } : null,
    stdout: { path: relative(repo, stdoutPath), bytes: fs.statSync(stdoutPath).size, sha256: hash(fs.readFileSync(stdoutPath)) },
    stderr: { path: relative(repo, stderrPath), bytes: fs.statSync(stderrPath).size, sha256: hash(fs.readFileSync(stderrPath)) }
  };
  fs.writeFileSync(join(report, name + '.status.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  results.push(record); console.log(name + ': status=' + record.status + ', signal=' + record.signal);
  return record;
};
run('01-node-version', node, ['--version']);
run('02-npm-version', npm, ['--version']);
const installation = run('03-npm-ci', npm, ['ci']);
if (installation.status === 0 && installation.signal === null && installation.launch_error === null) {
  run('04-original81', node, ['node_modules/vitest/vitest.mjs', 'run', 'tests/diagnostics/windows-p1-stages.test.ts', '--reporter=json', '--outputFile=' + join(report, '04-original81.raw.json')]);
  run('05-verify', npm, ['run', 'verify']);
  run('06-syntax', node, ['--check', 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs']);
  run('07-pure-import', node, ['--input-type=module', '-e', "await import('./docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs')"]);
}
const logsSource = join(home, 'npm-cache/_logs'), logsDestination = join(report, 'npm-debug');
fs.mkdirSync(logsDestination);
const npmLogs = fs.existsSync(logsSource) ? fs.readdirSync(logsSource).sort().map(name => {
  const original = join(logsSource, name), dest = join(logsDestination, name);
  assert(fs.lstatSync(original).isFile());
  fs.copyFileSync(original, dest, fs.constants.COPYFILE_EXCL);
  const bytes = fs.readFileSync(original); assert(bytes.equals(fs.readFileSync(dest)));
  return { original, report_path: relative(repo, dest), bytes: bytes.length, sha256: hash(bytes), exact_copy: true };
}) : [];
const lock = JSON.parse(fs.readFileSync(join(repo, 'package-lock.json')));
const lockPath = join(repo, 'node_modules/.package-lock.json');
const installedLock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath)) : { packages: {} };
if (fs.existsSync(lockPath)) fs.copyFileSync(lockPath, join(report, '08-installed-package-lock.original.json'), fs.constants.COPYFILE_EXCL);
const symlinks = [], packages = [];
const visit = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const realpath = fs.realpathSync(path);
      assert(realpath === repo || realpath.startsWith(repo + '/'), path + ': dependency link escaped own worktree');
      symlinks.push({ path: relative(repo, path), target: fs.readlinkSync(path), realpath });
    } else if (entry.isDirectory()) visit(path);
    else if (entry.name === 'package.json') {
      const bytes = fs.readFileSync(path);
      let p;
      try { p = JSON.parse(bytes); } catch { continue; }
      if (typeof p.name !== 'string' || typeof p.version !== 'string') continue;
      const dir = relative(repo, directory), locked = lock.packages[dir];
      const lifecycle = Object.fromEntries(['preinstall', 'install', 'postinstall'].filter(key => typeof p.scripts?.[key] === 'string').map(key => [key, p.scripts[key]]));
      packages.push({ path: dir, name: p.name, version: p.version, package_json_sha256: hash(bytes), package_lock_entry_present: Boolean(locked),
        locked_version: locked?.version ?? null, installed_package_lock_entry_present: Boolean(installedLock.packages[dir]), lifecycle });
    }
  }
};
if (fs.existsSync(join(repo, 'node_modules'))) visit(join(repo, 'node_modules'));
const postinstallFiles = ['node_modules/next/dist/lib/setup-next-swc.js', 'node_modules/next/dist/lib/download-swc.js',
  'node_modules/next/dist/build/swc/index.js', 'node_modules/@prisma/client/scripts/postinstall.js',
  'node_modules/prisma/scripts/preinstall-entry.js', 'node_modules/@prisma/engines/scripts/postinstall.js',
  'node_modules/better-sqlite3/package.json'].filter(path => fs.existsSync(join(repo, path))).map(path => {
  const bytes = fs.readFileSync(join(repo, path)); return { path, bytes: bytes.length, sha256: hash(bytes) };
});
const provenance = {
  role: 'fresh-supporting-Generator', source: '712cf210b089dc71f3a6e6ed2e19e1de7fee57da',
  own_home: home, own_cache: env.npm_config_cache, own_tmp: env.TMPDIR, env,
  install_attempts: 1, installation_stopped_further_execution: installation.status !== 0,
  commands: results, npm_logs: npmLogs, symlinks, packages, postinstall_files: postinstallFiles,
  lock_absent_package_json_entries: packages.filter(row => !row.package_lock_entry_present),
  lifecycle_packages: packages.filter(row => Object.keys(row.lifecycle).length),
  native_Windows_or_target_CLI_or_new_VM_execution: false,
  original81_existing_synthetic_VM_slices: 'Authorized unchanged by Coordinator clarification 7676ef4; no new/extra VM controls',
  all_lock_only_or_native_pass_claim: false, independent_acceptance: false, release_ready: false
};
fs.writeFileSync(join(report, 'development-provenance.json'), JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });
console.log('npm debug originals: ' + npmLogs.length + '; dependency symlinks confined: ' + symlinks.length);
process.exitCode = installation.status === 0 ? 0 : 1;
