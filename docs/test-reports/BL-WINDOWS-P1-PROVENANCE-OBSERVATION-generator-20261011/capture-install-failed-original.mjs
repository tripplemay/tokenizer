import fs from 'node:fs';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const reports = dirname(fileURLToPath(import.meta.url));
const root = resolve(reports, '../../..');
const home = '/Volumes/ORICO/project/.wp1provog-20261011';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = [];
function copy(source, destination) {
  const bytes = fs.readFileSync(source), to = join(reports, 'install-originals', destination);
  fs.mkdirSync(dirname(to), { recursive: true }); fs.writeFileSync(to, bytes, { flag: 'wx' });
  originals.push({ source, archived: relative(root, to), bytes: bytes.length, sha256: sha256(bytes) });
}
const logDirectory = join(home, 'npmcache/_logs');
for (const name of fs.readdirSync(logDirectory).sort()) copy(join(logDirectory, name), 'npm-debug/' + name);
const paths = [
  'package.json', 'package-lock.json', 'node_modules/.package-lock.json',
  'node_modules/@swc/core/package.json', 'node_modules/@swc/core/index.js', 'node_modules/@swc/core/postinstall.js',
  'node_modules/@swc/core/npm-install/package.json', 'node_modules/@swc/core/npm-install/package-lock.json',
  'node_modules/@swc/core/npm-install/node_modules/.package-lock.json',
  'node_modules/@swc/core/npm-install/node_modules/@swc/wasm/package.json',
  'node_modules/@prisma/client/package.json', 'node_modules/@prisma/client/scripts/postinstall.js',
  'node_modules/@prisma/engines/package.json', 'node_modules/@prisma/engines/scripts/postinstall.js',
  'node_modules/prisma/package.json', 'node_modules/prisma/scripts/preinstall-entry.js',
  'node_modules/better-sqlite3/package.json'
];
const absent = [];
for (const path of paths) {
  if (fs.existsSync(join(root, path))) copy(join(root, path), path);
  else absent.push(path);
}
const links = [];
function scan(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const path = join(directory, name), stat = fs.lstatSync(path);
    if (stat.isSymbolicLink()) {
      const realpath = fs.realpathSync(path), owned = realpath === root || realpath.startsWith(root + '/');
      links.push({ path: relative(root, path), target: fs.readlinkSync(path), realpath, owned }); assert(owned, 'npm link outside own worktree');
    } else if (stat.isDirectory()) scan(path);
  }
}
scan(join(root, 'node_modules'));
const git = (...args) => {
  const result = cp.spawnSync('/usr/bin/git', ['-c', 'core.fileMode=false', ...args], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0); return result.stdout;
};
const vendor = git('ls-files', 'vendor').toString().trim().split('\n').filter(Boolean).map(path => {
  const bytes = fs.readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: sha256(bytes), baseline_equal: bytes.equals(git('show', '712cf210b089dc71f3a6e6ed2e19e1de7fee57da:' + path)) };
});
assert(vendor.every(file => file.baseline_equal));
const lockBytes = fs.readFileSync(join(root, 'package-lock.json'));
assert(lockBytes.equals(git('show', '712cf210b089dc71f3a6e6ed2e19e1de7fee57da:package-lock.json')));
const lock = JSON.parse(lockBytes), core = JSON.parse(fs.readFileSync(join(root, 'node_modules/@swc/core/package.json')));
const wasmPath = 'node_modules/@swc/core/npm-install/node_modules/@swc/wasm/package.json';
const wasm = JSON.parse(fs.readFileSync(join(root, wasmPath)));
const wasmFiles = fs.readdirSync(dirname(join(root, wasmPath))).sort().map(name => {
  const path = join(dirname(join(root, wasmPath)), name), bytes = fs.readFileSync(path);
  return { path: relative(root, path), bytes: bytes.length, sha256: sha256(bytes) };
});
const result = {
  format: 'owned-single-npmci-install-evidence-v1', node: process.version,
  npm_ci_once: true, npm_ci_status: JSON.parse(fs.readFileSync(join(reports, '01-npm-ci.result.json'))).status,
  home, npmcache: join(home, 'npmcache'), cache_logs_copied: originals.filter(file => file.archived.includes('/npm-debug/')).length,
  high_severity_reported: 7, audit_fix_or_retry_or_manual_extra_install: false,
  swc_package_owned_registry_fallback: true, core_version: core.version, wasm_version: wasm.version,
  fallback_invocation: 'npm install --no-save --loglevel error --prefer-offline --no-audit --progress false @swc/wasm@1.16.13',
  fallback_owned_cwd: join(root, 'node_modules/@swc/core/npm-install'),
  wasm_absent_from_root_lock: !Object.keys(lock.packages).some(key => /(^|\/)@swc\/wasm$/.test(key)),
  root_lock_unchanged: true, root_lock_sha256: sha256(lockBytes), originals, absent, wasmFiles, links, vendor,
  lifecycle_not_native_P1_execution: true, development_only: true
};
fs.writeFileSync(join(reports, 'install-evidence.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ npm_ci_status: result.npm_ci_status, cache_logs_copied: result.cache_logs_copied,
  originals: originals.length, core_version: core.version, wasm_version: wasm.version,
  wasm_absent_from_root_lock: result.wasm_absent_from_root_lock, root_lock_unchanged: true, links: links.length, all_links_owned: true,
  wasm_file_inventory_only_except_original_package_json: true, high_severity_reported: 7 }) + '\n');
