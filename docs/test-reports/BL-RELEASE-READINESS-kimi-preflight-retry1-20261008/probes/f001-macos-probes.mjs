// Independent Kimi preflight probes for F001 macOS launchd composition.
// - resolveLaunchdIdentity isolation rules: the exact function bytes are extracted from
//   src/cli/service.ts and evaluated with injected node:os/node:path deps (the module's
//   '@/' alias imports prevent a plain import; the function itself is dependency-pure)
// - assert-macos-launchd-installer.mjs gate against evaluator-crafted reports
// - byte-identity of transported files vs declared source commit 3d0a974 (git show)
// - adjudicated F002 predicate revision bytes; workflow statics (B06/B07 floor preserved)
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const results = [];
let root;
async function check(name, fn) {
  root = mkdtempSync(join(tmpdir(), 'kimi-f001-'));
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e) }); }
  rmSync(root, { recursive: true, force: true });
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

await check('launchd identity: production default; isolated label rules; real HOME rejected', () => {
  const src = readFileSync('src/cli/service.ts', 'utf8');
  const start = src.indexOf('export function resolveLaunchdIdentity');
  expect(start > 0, 'resolveLaunchdIdentity not found in service.ts');
  // find the closing brace of the function by brace counting
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  expect(end > start, 'cannot extract function body');
  const body = src.slice(start, end).replace('export function', 'function')
    .replace(/: LaunchdIdentity/g, '').replace(/: Readonly<Record<string, string \| undefined>>/g, '')
    .replace(/home = homedir\(\)/, 'home = homedir()').replace(/\(home: string/, '(home');
  const factory = new Function('homedir', 'tmpdir', 'resolve', 'join', 'sep',
    `${body}; return resolveLaunchdIdentity;`);
  const resolveLaunchdIdentity = factory(homedir, tmpdir, resolve, join, sep);
  const tmpHome = join(tmpdir(), 'kimi-probe-home');
  expect(resolveLaunchdIdentity(tmpHome, {}).label === 'cc.tokenizer.agent', 'default label');
  expect(resolveLaunchdIdentity(tmpHome, {}).plist.endsWith('Library/LaunchAgents/cc.tokenizer.agent.plist'), 'default plist');
  expect(resolveLaunchdIdentity(tmpHome, { TOKENIZER_LAUNCHD_TEST_MODE: '1', TOKENIZER_LAUNCHD_TEST_LABEL: 'cc.tokenizer.agent.ci.probe1' }).label === 'cc.tokenizer.agent.ci.probe1', 'isolated label');
  for (const [env, msg] of [
    [{ TOKENIZER_LAUNCHD_TEST_LABEL: 'cc.tokenizer.agent.ci.x' }, 'requires TOKENIZER_LAUNCHD_TEST_MODE=1'],
    [{ TOKENIZER_LAUNCHD_TEST_MODE: '1', TOKENIZER_LAUNCHD_TEST_LABEL: 'cc.tokenizer.agent' }, 'Invalid isolated launchd test label'],
    [{ TOKENIZER_LAUNCHD_TEST_MODE: '1', TOKENIZER_LAUNCHD_TEST_LABEL: 'cc.tokenizer.agent.ci.' }, 'Invalid isolated launchd test label'],
    [{ TOKENIZER_LAUNCHD_TEST_MODE: '1', TOKENIZER_LAUNCHD_TEST_LABEL: 'cc.other.agent.ci.x' }, 'Invalid isolated launchd test label'],
    [{ TOKENIZER_LAUNCHD_TEST_MODE: '1', TOKENIZER_LAUNCHD_TEST_LABEL: 'cc.tokenizer.agent.ci.x;rm' }, 'Invalid isolated launchd test label'],
  ]) {
    let threw = null;
    try { resolveLaunchdIdentity(tmpHome, env); } catch (e) { threw = e.message; }
    expect(threw && threw.includes(msg), `expected '${msg}', got '${threw}'`);
  }
  let threw = null;
  try { resolveLaunchdIdentity('/Users/whoever', { TOKENIZER_LAUNCHD_TEST_MODE: '1', TOKENIZER_LAUNCHD_TEST_LABEL: 'cc.tokenizer.agent.ci.x' }); } catch (e) { threw = e.message; }
  expect(threw && threw.includes('inside the OS temporary directory'), `real HOME not rejected: ${threw}`);
});

await check('installer gate: accepts exactly one native pass; rejects fail/skip/rename/dup/wrong-OS', () => {
  const gate = join(process.cwd(), 'scripts/ci/assert-macos-launchd-installer.mjs');
  const name = 'native macOS launchd pinned installer fixture installs and upgrades a live isolated service, restores it after failure, and rolls back offline without touching the default label';
  const ok = { success: true, numFailedTests: 0, numPassedTests: 1, testResults: [{ assertionResults: [{ fullName: name, status: 'passed' }] }] };
  const invoke = (body, platform = 'darwin') => {
    const p = join(root, 'r.json');
    writeFileSync(p, JSON.stringify(body));
    return spawnSync(process.execPath, ['--input-type=module', '-e',
      `Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});process.argv=[process.execPath,${JSON.stringify(gate)},${JSON.stringify(p)}];await import(${JSON.stringify(pathToFileURL(gate).href)});`],
      { encoding: 'utf8', timeout: 5000 });
  };
  expect(invoke(ok).status === 0, 'valid report rejected');
  expect(invoke(ok, 'linux').status !== 0, 'non-macOS accepted');
  expect(invoke({ ...ok, numPassedTests: 2 }).status !== 0, 'two passes accepted');
  expect(invoke({ ...ok, testResults: [{ assertionResults: [{ fullName: name, status: 'focused' }] }] }).status !== 0, 'focused accepted');
  expect(invoke({ ...ok, testResults: [{ assertionResults: [] }] }).status !== 0, 'empty accepted');
  expect(invoke({ ...ok, testResults: [{ assertionResults: [{ fullName: name.toUpperCase(), status: 'passed' }] }] }).status !== 0, 'case-renamed accepted');
});

await check('transported F001 bytes are identical to declared source commit 3d0a974', () => {
  const provenance = JSON.parse(readFileSync('docs/test-reports/BL-RELEASE-READINESS-generator-20261008/F001-provenance.json', 'utf8'));
  const src = '3d0a974f4916c911917e1b09811c98d5c96b1ec0';
  let haveSource = true;
  try { execFileSync('git', ['cat-file', '-e', `${src}^{commit}`]); } catch { haveSource = false; }
  expect(haveSource, 'source commit 3d0a974 not present in repo object store');
  for (const f of provenance.files.filter((x) => x.feature === 'F001')) {
    const actual = sha256(readFileSync(f.path));
    expect(actual === f.actual_sha256, `${f.path}: drifted from provenance record (${actual} != ${f.actual_sha256})`);
    if (f.identical) {
      const source = execFileSync('git', ['show', `${src}:${f.path}`]);
      expect(sha256(source) === f.source_sha256 && sha256(source) === actual, `${f.path}: differs from source commit bytes`);
    }
  }
});

await check('F002 predecessor guard bytes match adjudicated revision record', () => {
  const rev = JSON.parse(readFileSync('docs/test-reports/BL-RELEASE-READINESS-generator-20261008/F002-null-code-revision.json', 'utf8'));
  const actual = sha256(readFileSync('scripts/verify-vps-predecessor.sh'));
  expect(actual === rev.revision_sha256, `verify-vps-predecessor.sh drifted: ${actual} != ${rev.revision_sha256}`);
  const body = readFileSync('scripts/verify-vps-predecessor.sh', 'utf8');
  expect(body.includes('((has("code") | not) or .code == "ready")'), 'adjudicated predicate missing');
  expect(!body.includes('.code==null'), 'old null-admitting predicate still present');
  const inv = readFileSync('scripts/ci/vps-host-preflight.sh', 'utf8');
  expect(inv.includes('(has("code") | not) or .code == "ready"'), 'F003 inventory does not use the same rule');
});

await check('workflow composes macOS gate without dropping accepted release prerequisites', () => {
  const wf = readFileSync('.github/workflows/deploy-vps.yml', 'utf8');
  expect(wf.includes('verify-macos-agent:'), 'macOS job missing');
  expect(wf.includes('runs-on: macos-latest'), 'not native macOS runner');
  expect(wf.includes('launchctl print "gui/$(id -u)"'), 'GUI domain check missing');
  expect((wf.match(/verify-macos-agent/g) || []).length >= 3, 'macOS gate not wired into needs');
  for (const token of [
    'tests/server/b06-batch-db.probe.test.ts', 'tests/server/b07-queue-id-ack-db.probe.test.ts',
    'postgres:16-alpine', 'assert-vitest-results.mjs .ci/db-probes.json 15',
    'tests/cli/agent-release-installer-windows.test.ts', 'npm run test:e2e',
    'attest-build-provenance', 'rehearse-release.sh',
  ]) {
    expect(wf.includes(token), `workflow lost prerequisite: ${token}`);
  }
});

const passed = results.filter((r) => r.pass).length;
console.log(JSON.stringify({ suite: 'f001-macos-probes', total: results.length, passed, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
