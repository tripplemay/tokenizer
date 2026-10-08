// Independent Kimi preflight probes for F002 scripts/verify-vps-predecessor.sh
// Evaluator-authored fixtures: stub docker/curl, synthetic ledger, byte-snapshot checks.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.env.PROBE_BASE || '/private/tmp/kimi-pf/probes';
const script = join(process.cwd(), 'scripts/verify-vps-predecessor.sh');
const CAND = 'c'.repeat(40), OLD = 'd'.repeat(40);
const APP_ID = `sha256:${'a'.repeat(64)}`;
const APP = `ghcr.io/probe/app@${APP_ID}`, MIG = `ghcr.io/probe/migrate@sha256:${'b'.repeat(64)}`;
const CANARY = 'KIMI_PROBE_SECRET_CANARY_NEVER_LEAK';
const results = [];
let root;

function stub(name, body) {
  const p = join(root, 'bin', name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}
function snap(dir = root, prefix = '') {
  const out = {};
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'bin' || e.name === 'calls.log') continue;
    const p = join(dir, e.name), k = prefix + e.name;
    if (e.isDirectory()) Object.assign(out, snap(p, `${k}/`));
    else out[k] = createHash('sha256').update(readFileSync(p)).digest('hex') + ':' + (statSync(p).mode & 0o7777).toString(8);
  }
  return out;
}
function fixture() {
  root = mkdtempSync(join(BASE, 'f002-'));
  mkdirSync(join(root, 'bin')); mkdirSync(join(root, '.releases'));
  const env = `GIT_COMMIT=${OLD}\nAPP_IMAGE=${APP}\nMIGRATE_IMAGE=${MIG}\nAPP_HOST_PORT=127.0.0.1:3010\nAUTH_SECRET=${CANARY}\n`;
  writeFileSync(join(root, '.env'), env);
  writeFileSync(join(root, 'docker-compose.yml'), 'services:\n  app: {}\n');
  writeFileSync(join(root, 'docker-compose.release.yml'), 'services:\n  app: {}\n');
  writeFileSync(join(root, '.releases', `${OLD}.manifest`), `commit=${OLD}\napp_image=${APP}\nmigrate_image=${MIG}\n`);
  writeFileSync(join(root, '.releases', `${OLD}.activated`), `commit=${OLD}\napp_image=${APP}\napp_id=${APP_ID}\n`);
  stub('docker', `printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  'image inspect --format {{.Id}} '*) echo "$PROBE_APP_ID" ;;
  *'config --quiet') exit 0 ;;
  *'config --format json') printf '{"name":"%s"}\\n' "\${PROBE_PROJECT:-tokenizer}" ;;
  *'ps -q app') if [ -n "\${PROBE_CONTAINER:-}" ]; then printf '%s\\n' "$PROBE_CONTAINER"; fi; exit 0 ;;
  inspect*) printf '%s\\n' "\${PROBE_DETAILS:-true|tokenizer|app|${APP_ID}}" ;;
  'port '*) printf '%s\\n' "\${PROBE_PORT:-127.0.0.1:3010}" ;;
  *) echo 'UNEXPECTED-MUTATION-ATTEMPT' >&2; exit 99 ;;
esac`);
  stub('curl', `if [ -n "\${PROBE_HEALTH+x}" ]; then printf '%s' "$PROBE_HEALTH"; else printf '{"ok":true,"code":"ready","commit":"%s"}' "\${OLD_SHA}"; fi`);
}
function spawnBash(args, overrides = {}, useCwd = true) {
  const probeEnv = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CALLS: join(root, 'calls.log'),
      OLD_SHA: OLD, PROBE_APP_ID: APP_ID, PROBE_CONTAINER: 'a1b2c3d4e5f6', ...overrides };
  // macOS sporadically returns ENOENT for a posix_spawn into a freshly created
  // cwd; warm the spawn path once, then retry a genuine ENOENT exactly once.
  spawnSync('bash', ['-c', 'true'], { encoding: 'utf8', env: probeEnv });
  const opts = { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: probeEnv };
  if (useCwd) opts.cwd = root;
  let r = spawnSync('bash', args, opts);
  if (r.error && r.error.errno === -2) r = spawnSync('bash', args, opts);
  if (r.error) throw new Error(`spawn error: ${r.error.message} signal=${r.signal} cwd-exists=${existsSync(root)}`);
  return r;
}
function run(mode = 'live', overrides = {}) {
  return spawnBash([script, mode, CAND, APP, MIG], overrides);
}
function check(name, fn) {
  fixture();
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e) }); }
  rmSync(root, { recursive: true, force: true });
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function callsLog() { return existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8') : ''; }
function noMutation() {
  expect(!/pull|push|\bup\b|\bstop\b|\brun\b|login|logout|exec|build|restart|kill|\brm\b/.test(callsLog()), 'mutation command in calls');
}
function noCanary(r) {
  expect(!`${r.stdout}${r.stderr}`.includes(CANARY), 'canary leaked');
}

check('live happy path: exact digest predecessor passes, read-only', () => {
  const before = snap();
  const r = run();
  expect(r.status === 0, `exit=${r.status} err=${r.stderr}`);
  expect(r.stdout.includes('production predecessor preflight passed'), 'missing pass line');
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed on success');
  noMutation();
});

check('explicit null health code is REFUSED (adjudicated predicate)', () => {
  const before = snap();
  const r = run('live', { PROBE_HEALTH: `{"ok":true,"code":null,"commit":"${OLD}"}` });
  expect(r.status !== 0, 'null code accepted');
  expect(r.stderr.includes('does not report the activated predecessor'), `wrong msg: ${r.stderr}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed on refusal');
  noMutation(); noCanary(r);
});

check('absent code field with ok=true and exact SHA is accepted (old format)', () => {
  const r = run('live', { PROBE_HEALTH: `{"ok":true,"commit":"${OLD}"}` });
  expect(r.status === 0, `exit=${r.status} err=${r.stderr}`);
});

check('wrong health code (db_unavailable) refused', () => {
  const r = run('live', { PROBE_HEALTH: `{"ok":true,"code":"db_unavailable","commit":"${OLD}"}` });
  expect(r.status !== 0, 'wrong code accepted'); noCanary(r);
});

check('health commit mismatch refused', () => {
  const r = run('live', { PROBE_HEALTH: `{"ok":true,"code":"ready","commit":"${'e'.repeat(40)}"}` });
  expect(r.status !== 0, 'wrong commit accepted');
});

check('legacy source-built predecessor image refused', () => {
  writeFileSync(join(root, '.env'), readFileSync(join(root, '.env'), 'utf8').replace(APP, 'tokenizer-app:latest'));
  const before = snap();
  const r = run();
  expect(r.status !== 0, 'legacy image accepted');
  expect(r.stderr.includes('digest-pinned'), `wrong msg: ${r.stderr}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed'); noCanary(r);
});

check('missing activation ledger refused', () => {
  rmSync(join(root, '.releases', `${OLD}.activated`));
  const before = snap();
  const r = run();
  expect(r.status !== 0, 'missing ledger accepted');
  expect(r.stderr.includes('activated predecessor ledger is missing'), `wrong msg: ${r.stderr}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
});

check('wrong backend port (0.0.0.0) refused', () => {
  const r = run('live', { PROBE_PORT: '0.0.0.0:3010' });
  expect(r.status !== 0, 'wrong port accepted'); noCanary(r);
});

check('duplicate GIT_COMMIT in baseline refused', () => {
  writeFileSync(join(root, '.env'), `${readFileSync(join(root, '.env'), 'utf8')}GIT_COMMIT=${OLD}\n`);
  const before = snap();
  const r = run();
  expect(r.status !== 0, 'duplicate accepted');
  expect(r.stderr.includes('missing or duplicate'), `wrong msg: ${r.stderr}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
});

check('missing running app refused before any candidate manifest write', () => {
  const r = run('live', { PROBE_CONTAINER: '' });
  expect(r.status !== 0, 'absent app accepted');
  expect(r.stderr.includes('exactly one running Compose app'), `wrong msg: ${r.stderr}`);
  expect(!existsSync(join(root, '.releases', `${CAND}.manifest`)), 'candidate manifest created');
});

check('two running apps refused', () => {
  const r = run('live', { PROBE_CONTAINER: 'a1b2c3d4e5f6\nf6e5d4c3b2a1' });
  expect(r.status !== 0, 'multiple apps accepted');
});

check('wrong compose project refused', () => {
  const r = run('live', { PROBE_DETAILS: `true|otherproject|app|${APP_ID}` });
  expect(r.status !== 0, 'wrong project accepted');
});

check('wrong service identity refused', () => {
  const r = run('live', { PROBE_DETAILS: `true|tokenizer|postgres|${APP_ID}` });
  expect(r.status !== 0, 'wrong service accepted');
});

check('non-running container refused', () => {
  const r = run('live', { PROBE_DETAILS: `false|tokenizer|app|${APP_ID}` });
  expect(r.status !== 0, 'stopped app accepted');
});

check('same-SHA predecessor refused', () => {
  writeFileSync(join(root, '.env'), readFileSync(join(root, '.env'), 'utf8').replaceAll(OLD, CAND));
  const r = run();
  expect(r.status !== 0, 'same SHA accepted');
});

check('stale previous-env retention record refused (byte mismatch)', () => {
  writeFileSync(join(root, '.releases', `${CAND}.previous-env`), 'stale\n');
  const r = run();
  expect(r.status !== 0, 'stale retention accepted');
  expect(r.stderr.includes('does not match the current baseline'), `wrong msg: ${r.stderr}`);
});

check('conflicting existing candidate manifest refused without rewrite', () => {
  const stale = `commit=${CAND}\napp_image=ghcr.io/probe/app@sha256:${'f'.repeat(64)}\nmigrate_image=${MIG}\n`;
  writeFileSync(join(root, '.releases', `${CAND}.manifest`), stale);
  const r = run();
  expect(r.status !== 0, 'conflict accepted');
  expect(r.stderr.includes('immutable candidate manifest differs'), `wrong msg: ${r.stderr}`);
  expect(readFileSync(join(root, '.releases', `${CAND}.manifest`), 'utf8') === stale, 'manifest rewritten');
});

check('retained mode: candidate env selecting different project refused', () => {
  // candidate .env = new sha; previous-env holds old sha
  const oldEnv = readFileSync(join(root, '.env'), 'utf8');
  writeFileSync(join(root, '.releases', `${CAND}.previous-env`), oldEnv);
  writeFileSync(join(root, '.env'), oldEnv.replace(OLD, CAND));
  const before = snap();
  const r = spawnBash([script, 'retained', CAND, APP, MIG]);
  expect(r.status === 0, `retained happy path exit=${r.status} err=${r.stderr}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
  noMutation();
});

check('invalid candidate args refused before any docker call', () => {
  const r = spawnBash([script, 'live', 'not-a-sha', APP, MIG]);
  expect(r.status !== 0, 'bad sha accepted');
  expect(!existsSync(join(root, 'calls.log')), 'docker called on invalid input');
});

const passed = results.filter(r => r.pass).length;
console.log(JSON.stringify({ suite: 'f002-predecessor-probes', total: results.length, passed, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
