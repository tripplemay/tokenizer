import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const repo = '/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-binding-identity-generator-20261011';
const report = join(repo, 'docs/test-reports/BL-WINDOWS-P1-BINDING-IDENTITY-generator-20261011');
const own = '/Volumes/ORICO/project/.wp1cbg-20261011';
const source = '61cf64e67a6fda231bb090e77c19d5ececb908af';
const output = join(report, 'dependency-provenance.raw.json');
assert.equal(resolve('.'), repo);
assert.equal(process.env.HOME, own);
assert.equal(process.env.USERPROFILE, own);
assert(!fs.existsSync(output));
const sha = b => createHash('sha256').update(b).digest('hex');
const meta = (path, bytes) => ({ path, bytes: bytes.length, sha256: sha(bytes) });
const commands = [];
const result = { format: 'windows-p1-C002-owned-dependency-provenance-v1', source,
  observed_at_utc: new Date().toISOString(), classification: 'read-only owned dependency evidence; not install security or functional acceptance',
  env: Object.fromEntries(['HOME', 'USERPROFILE', 'TMPDIR', 'PATH', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].map(k => [k, process.env[k]])) };
function git(args) {
  const a = ['-c', 'core.fileMode=false', ...args];
  const r = cp.spawnSync('/usr/bin/git', a, { cwd: repo, env: process.env, maxBuffer: 10 * 1024 * 1024 });
  commands.push({ executable: '/usr/bin/git', args: a, cwd: repo, status: r.status, signal: r.signal,
    stdout: meta('stdout', r.stdout ?? Buffer.alloc(0)), stderr: (r.stderr ?? Buffer.alloc(0)).toString() });
  assert.equal(r.status, 0); assert.equal(r.signal, null); assert(!r.error);
  return r.stdout;
}
try {
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), source);
  const authorityPath = 'docs/test-reports/BL-RELEASE-READINESS-coordination-20261011/windows-binding-identity-owned-vendor-dependency-clarification.json';
  const authorityBytes = fs.readFileSync(join('/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008', authorityPath));
  assert(authorityBytes.equals(git(['show', `4d938c8:${authorityPath}`])));
  const authority = JSON.parse(authorityBytes);
  result.authority = { ...meta(authorityPath, authorityBytes), commit: '4d938c8', observed_at: authority.observed_at };
  const lock = JSON.parse(fs.readFileSync(join(repo, 'package-lock.json')));
  assert.deepEqual(lock.packages['node_modules/braces'], { resolved: 'vendor/braces', link: true });
  assert(!fs.lstatSync(join(repo, 'node_modules')).isSymbolicLink());
  assert(fs.lstatSync(join(repo, 'node_modules/braces')).isSymbolicLink());
  assert.equal(fs.realpathSync(join(repo, 'node_modules/braces')), join(repo, 'vendor/braces'));
  result.vendor_link = { path: 'node_modules/braces', link: fs.readlinkSync(join(repo, 'node_modules/braces')),
    realpath: fs.realpathSync(join(repo, 'node_modules/braces')), npm_owned_fresh_install: true,
    preexisting_dependency_root: false, source_worktree: repo };
  const vendorRows = git(['ls-tree', '-r', source, '--', 'vendor/braces']).toString().trimEnd().split('\n');
  assert.equal(vendorRows.length, 12);
  result.vendor_files = vendorRows.map(row => {
    const path = row.slice(row.indexOf('\t') + 1), bytes = fs.readFileSync(join(repo, path));
    assert(bytes.equals(git(['show', `${source}:${path}`])));
    assert(bytes.equals(git(['show', `221f2f87d94db1656e3000662796d79621b696f5:${path}`])));
    return { ...meta(path, bytes), source_tree_row: row };
  });
  const links = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const realpath = fs.realpathSync(path);
        assert(realpath.startsWith(repo + '/'), `no external or cross-worktree dependency link: ${path}`);
        links.push({ path: path.slice(repo.length + 1), link: fs.readlinkSync(path), realpath });
      } else if (entry.isDirectory()) walk(path);
    }
  }
  walk(join(repo, 'node_modules'));
  result.all_installed_symlinks = links;
  result.no_installed_symlink_target_outside_owned_worktree = true;
  result.normal_bin_links = links.filter(x => x.path.includes('/.bin/'));
  const npmLogRoot = join(own, 'cache/npm/_logs');
  result.owned_npm_debug_originals = fs.readdirSync(npmLogRoot).filter(n => n.endsWith('.log')).sort().map(name => {
    const bytes = fs.readFileSync(join(npmLogRoot, name));
    const path = 'npm-debug-' + name;
    fs.writeFileSync(join(report, path), bytes, { flag: 'wx' });
    return { ...meta(path, bytes), original_path: join(npmLogRoot, name) };
  });
  const npmStatus = JSON.parse(fs.readFileSync(join(report, '03-npm-ci.status.json')));
  result.authorization_order = { npm_ci_started_at_utc: npmStatus.started_at_utc,
    clarification_observed_at_utc: authority.observed_at,
    npm_started_before_narrow_clarification_was_landed: npmStatus.started_at_utc < authority.observed_at,
    no_precreated_or_borrowed_links: true };
  const stderr = fs.readFileSync(join(report, '03-npm-ci.stderr.log'), 'utf8');
  const stdout = fs.readFileSync(join(report, '03-npm-ci.stdout.log'), 'utf8');
  const swcScript = fs.readFileSync(join(repo, 'node_modules/@swc/core/postinstall.js'));
  const wasm = JSON.parse(fs.readFileSync(join(repo, 'node_modules/@swc/wasm/package.json')));
  const swc = JSON.parse(fs.readFileSync(join(repo, 'node_modules/@swc/core/package.json')));
  assert(stderr.includes('ERR_SWC_NATIVE_CACHE'));
  assert(stdout.includes('7 high severity vulnerabilities'));
  assert.equal(wasm.version, swc.version);
  assert.equal(swc.version, lock.packages['node_modules/@swc/core'].version);
  result.install_limitations = { npm_ci_status: npmStatus.status,
    npm_high_warning: 7, swc_native_cache_validation_error_logged: true,
    fallback_package: { name: wasm.name, version: wasm.version,
      parent_locked_version: swc.version, lock_entry_present: Boolean(lock.packages['node_modules/@swc/wasm']),
      package: meta('node_modules/@swc/wasm/package.json', fs.readFileSync(join(repo, 'node_modules/@swc/wasm/package.json'))) },
    fallback_source: meta('node_modules/@swc/core/postinstall.js', swcScript),
    fallback_source_lines: swcScript.toString().split('\n').flatMap((line, i) =>
      /execSync|npm install|@swc\/wasm|installDir|renameSync/.test(line) ? [{ line: i + 1, text: line }] : []),
    fallback_kind: 'unchanged locked package lifecycle launched npm install @swc/wasm at exact parent version; no agent manual install, override, retry or permission repair',
    observed_registry_fallback_fetch: 'own npm debug 2026-10-11T16_47_27_357Z-debug-0.log records GET 200 registry.npmjs.org wasm metadata and tarball',
    native_binding_success_claimed: false, dependency_security_acceptance: false,
    lifecycle_public_binary_hosts_directly_observed: false, complete_egress_isolation_claimed: false };
  const ignored = git(['status', '--ignored', '--short', '--', 'node_modules', 'tsconfig.tsbuildinfo', '.next']);
  result.machine_generated_ignored_state = ignored.toString();
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  result.commands = commands;
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ok: result.ok, vendor_file_count: result.vendor_files?.length,
    symlink_count: result.all_installed_symlinks?.length, npm_original_logs: result.owned_npm_debug_originals?.length,
    authorization_order: result.authorization_order, install_limitations: result.install_limitations,
    failure: result.failure }));
}
