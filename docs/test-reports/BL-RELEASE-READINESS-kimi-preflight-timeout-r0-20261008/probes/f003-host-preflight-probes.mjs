// Independent Kimi preflight probes for F003 scripts/ci/vps-host-preflight.sh
// Evaluator-authored fixtures: stub docker/curl/uname/df/stat/sha256sum/timeout,
// synthetic deploy tree with canary secrets, byte-snapshot + no-mutation checks.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.env.PROBE_BASE || '/private/tmp/kimi-pf/probes';
const script = join(process.cwd(), 'scripts/ci/vps-host-preflight.sh');
const SHA = 'c'.repeat(40), DEPLOYED = 'd'.repeat(40);
const APP_ID = 'a1b2c3d4e5f6', PG_ID = 'b1c2d3e4f5a6';
const APP_IMAGE_ID = `sha256:${'a'.repeat(64)}`, PG_IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const APP_IMG = `ghcr.io/probe/app@${APP_IMAGE_ID}`, MIG_IMG = `ghcr.io/probe/migrate@sha256:${'e'.repeat(64)}`;
const CANARY = 'KIMI_F003_SECRET_CANARY_DO_NOT_DISCLOSE';
const results = [];
let root, deployPath;

function tool(name, body) {
  const p = join(root, 'bin', name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}
function snap(dir = deployPath, prefix = '') {
  const out = {};
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name), k = prefix + e.name;
    if (e.isDirectory() && !e.isSymbolicLink()) Object.assign(out, snap(p, `${k}/`));
    else if (e.isSymbolicLink()) out[k] = 'SYMLINK';
    else out[k] = createHash('sha256').update(readFileSync(p)).digest('hex') + ':' + (statSync(p).mode & 0o7777).toString(8);
  }
  return out;
}
function fixture() {
  root = mkdtempSync(join(BASE, 'f003-'));
  deployPath = join(root, 'deploy');
  mkdirSync(join(root, 'bin')); mkdirSync(deployPath); mkdirSync(join(deployPath, '.releases'));
  writeFileSync(join(deployPath, '.env'),
    `GIT_COMMIT=${DEPLOYED}\nAPP_IMAGE=${APP_IMG}\nMIGRATE_IMAGE=${MIG_IMG}\nAPP_HOST_PORT=127.0.0.1:3010\nAUTH_SECRET=${CANARY}\nDATABASE_URL=postgresql://u:${CANARY}@h/db\n`);
  writeFileSync(join(deployPath, 'docker-compose.yml'), `services: {}\n# ${CANARY}\n`);
  writeFileSync(join(deployPath, 'docker-compose.release.yml'), 'services: {}\n');
  writeFileSync(join(deployPath, '.releases', `${DEPLOYED}.manifest`), `commit=${DEPLOYED}\napp_image=${APP_IMG}\nmigrate_image=${MIG_IMG}\n`);
  writeFileSync(join(deployPath, '.releases', `${DEPLOYED}.activated`), `commit=${DEPLOYED}\napp_image=${APP_IMG}\napp_id=${APP_IMAGE_ID}\n`);

  tool('timeout', `limit="$2"; shift 2
"$@" & pid=$!
( sleep "\${limit%s}"; kill -KILL "$pid" 2>/dev/null ) >/dev/null 2>&1 &
watcher=$!
wait "$pid" 2>/dev/null; status=$?
kill -KILL "$watcher" 2>/dev/null
exit $status`);
  tool('uname', 'if [ "$1" = -s ]; then echo Linux; else echo x86_64; fi');
  tool('df', "printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 100000 100 99900 1%% /x\\n'");
  tool('stat', `fmt="$2"; path="$4"
if [ "$fmt" = %s ]; then /usr/bin/stat -f%z "$path"; elif [ "$fmt" = %a ]; then /usr/bin/stat -f%Lp "$path"; else exit 99; fi`);
  tool('sha256sum', '/usr/bin/shasum -a 256 "$@"');
  tool('curl', `printf '%s' "$CANARY" >&2
if [ "\${SCENARIO:-}" = health-failure ]; then exit 7; fi
if [ -n "\${HEALTH_RAW:-}" ]; then printf '%s' "$HEALTH_RAW"; exit 0; fi
printf '{"ok":%s,"code":%s,"commit":"%s","leaked":"%s"}' \\
  "\${HEALTH_OK:-true}" "\${HEALTH_CODE:-\\"ready\\"}" "\${HEALTH_COMMIT:-${DEPLOYED}}" "$CANARY"`);
  tool('docker', `printf '%s\\n' "$*" >> "$CALLS"
printf '%s' "$CANARY" >&2
s="\${SCENARIO:-}"
case "$*" in
  'version --format {{.Server.Version}}') [ "$s" = timeout ] && exec sleep 60; [ "$s" = raw-version-canary ] && echo "$CANARY" || echo 27.5.1 ;;
  'compose version --short') echo 2.35.1 ;;
  *'ps -a --filter label=com.docker.compose.project=tokenizer --filter label=com.docker.compose.service=app'*)
    [ "$s" = missing-app ] && exit 0; [ "$s" = duplicate-app ] && { echo ${APP_ID}; echo f1f2f3f4f5f6; exit 0; }; echo ${APP_ID} ;;
  *'ps -a --filter label=com.docker.compose.project=tokenizer --filter label=com.docker.compose.service=postgres'*)
    [ "$s" = no-postgres ] && exit 0; echo ${PG_ID} ;;
  'inspect --format {{.State.Running}}|'*)
    running=true; health=healthy; project=tokenizer; service=app; img=${APP_IMAGE_ID}
    [ "$s" = stopped-app ] && running=false
    [ "$s" = unhealthy-app ] && health=unhealthy
    [ "$s" = wrong-project ] && project=other
    [ "$s" = wrong-service ] && service=postgres
    [ "$s" = legacy-image ] && img=sha256:notdigest
    printf '%s|%s|%s|%s|%s|%s\\n' "$running" running "$health" "$project" "$service" "$img" ;;
  'inspect --format {{.State.Status}}|'*)
    printf 'running|healthy|tokenizer|postgres|%s\\n' "${PG_IMAGE_ID}" ;;
  'image inspect --format {{.Id}} '*)
    [ "$s" = wrong-image-id ] && echo "sha256:$(printf 'f%.0s' {1..64} 2>/dev/null || echo ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)" || echo "${APP_IMAGE_ID}" ;;
  'image inspect --format {{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Config.User}} '*)
    printf '%s|%s\\n' "\${IMAGE_REVISION:-$DEPLOYED}" "\${IMAGE_USER:-node}" ;;
  'inspect --format {{range $name, $_ := .NetworkSettings.Networks}}'*)
    [ "$s" = wrong-network ] && echo 'personal_net ' || echo 'tokenizer_default ' ;;
  'inspect --format {{range .Mounts}}'*)
    [ "$s" = wrong-volume ] && echo 'personal_vol ' || echo 'tokenizer_postgres-data ' ;;
  'port '*)
    [ "$s" = wrong-port ] && echo '0.0.0.0:3010' || echo '127.0.0.1:3010' ;;
  'network inspect --format '*' tokenizer_default') echo 'tokenizer|bridge' ;;
  'volume inspect --format '*' tokenizer_postgres-data') echo 'tokenizer|local' ;;
  *) echo "UNEXPECTED-DOCKER-OP:$*" >&2; exit 99 ;;
esac`);
}
function spawnBash(args, overrides = {}) {
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CALLS: join(root, 'calls.jsonl'), ...overrides };
  spawnSync('bash', ['-c', 'true'], { encoding: 'utf8', env });
  const opts = { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024, env };
  let r = spawnSync('bash', args, opts);
  if (r.error && r.error.errno === -2) r = spawnSync('bash', args, opts);
  if (r.error) throw new Error(`spawn error: ${r.error.message}`);
  return r;
}
function run(overrides = {}, args = [deployPath, SHA]) {
  return spawnBash([script, ...args], overrides);
}
function calls() {
  return existsSync(join(root, 'calls.jsonl'))
    ? readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n') : [];
}
function check(name, fn) {
  fixture();
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e) }); }
  rmSync(root, { recursive: true, force: true });
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function noCanary(r) {
  expect(!String(r.stdout).includes(CANARY), 'canary in stdout');
  expect(!String(r.stderr).includes(CANARY), 'canary in stderr');
}
function assertReadOnly() {
  for (const line of calls()) {
    const first = line.split(' ')[0];
    expect(['version', 'compose', 'ps', 'inspect', 'image', 'port', 'network', 'volume'].includes(first), `unexpected docker op: ${line}`);
    expect(!/Config\.Env|\b(pull|push|run|exec|stop|start|restart|up|down|kill|login|logout|build|rm|prune|cp|create)\b/.test(line), `mutation op: ${line}`);
  }
}
function parse(r) {
  noCanary(r);
  return JSON.parse(r.stdout);
}

check('observed digest_activated baseline, allowlisted output, byte-identical state', () => {
  const before = snap();
  const r = run();
  expect(r.status === 0, `exit=${r.status} out=${String(r.stdout).slice(0, 400)}`);
  const body = parse(r);
  expect(body.outcome === 'observed' && body.baseline === 'digest_activated', `bad outcome: ${JSON.stringify(body).slice(0, 200)}`);
  expect(body.source_sha === SHA && body.project === 'tokenizer', 'identity mismatch');
  expect(body.settings.GIT_COMMIT === DEPLOYED, 'settings commit mismatch');
  expect(body.app.id === APP_ID && body.app.user === 'node', 'app fields');
  expect(body.postgres.id === PG_ID && body.postgres.volume === 'tokenizer_postgres-data', 'pg fields');
  expect(body.files.env.sha256 === createHash('sha256').update(readFileSync(join(deployPath, '.env'))).digest('hex'), 'env hash');
  expect(!/DATABASE_URL|AUTH_SECRET|leaked|Config\.Env/.test(r.stdout), 'secret material in report');
  const allowed = ['schema_version','operation','source_sha','timestamp','outcome','reason','project','baseline','platform','free_kib','versions','settings','app','postgres','storage','files'];
  expect(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(allowed.sort()), 'unexpected top-level keys');
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
  assertReadOnly();
});

check('healthy legacy source-built serving reports legacy_or_unknown, no ledger created', () => {
  writeFileSync(join(deployPath, '.env'), readFileSync(join(deployPath, '.env'), 'utf8')
    .replace(APP_IMG, 'tokenizer-app:local').replace(MIG_IMG, 'tokenizer-migrate:local'));
  rmSync(join(deployPath, '.releases'), { recursive: true });
  const before = snap();
  const r = run();
  expect(r.status === 0, `exit=${r.status} out=${String(r.stdout).slice(0, 400)}`);
  const body = parse(r);
  expect(body.baseline === 'legacy_or_unknown', `baseline=${body.baseline}`);
  expect(body.files.releases.sha256 === 'missing', 'releases marker');
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
  assertReadOnly();
});

check('explicit null health code refused (backend_unready)', () => {
  const before = snap();
  const r = run({ HEALTH_CODE: 'null' });
  expect(r.status !== 0, 'null code accepted');
  expect(parse(r).reason === 'backend_unready', `reason=${JSON.parse(r.stdout).reason}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
  assertReadOnly();
});

check('absent health code field accepted only with exact SHA (old format)', () => {
  const r = run({ HEALTH_RAW: `{"ok":true,"commit":"${DEPLOYED}"}` });
  expect(r.status === 0, `exit=${r.status} out=${String(r.stdout).slice(0, 200)}`);
  expect(parse(r).outcome === 'observed', 'not observed');
});

check('wrong health code refused', () => {
  const r = run({ HEALTH_CODE: '"db_unavailable"' });
  expect(r.status !== 0, 'wrong code accepted');
});

check('health commit mismatch refused (wrong_backend_revision)', () => {
  const r = run({ HEALTH_COMMIT: 'e'.repeat(40) });
  expect(r.status !== 0, 'wrong commit accepted');
  expect(JSON.parse(r.stdout).reason === 'wrong_backend_revision', `reason=${JSON.parse(r.stdout).reason}`);
});

check('duplicate GIT_COMMIT refused as duplicate_setting, byte-identical', () => {
  writeFileSync(join(deployPath, '.env'), `${readFileSync(join(deployPath, '.env'), 'utf8')}GIT_COMMIT=${DEPLOYED}\n`);
  const before = snap();
  const r = run();
  expect(r.status !== 0, 'duplicate accepted');
  expect(JSON.parse(r.stdout).reason === 'duplicate_setting', `reason=${JSON.parse(r.stdout).reason}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
});

check('malicious APP_IMAGE value refused, never executed', () => {
  writeFileSync(join(deployPath, '.env'), readFileSync(join(deployPath, '.env'), 'utf8')
    .replace(APP_IMG, `$(touch ${join(deployPath, 'PWNED')})`));
  const before = snap();
  const r = run();
  expect(r.status !== 0, 'malicious image accepted');
  expect(JSON.parse(r.stdout).reason === 'invalid_setting', `reason=${JSON.parse(r.stdout).reason}`);
  expect(!existsSync(join(deployPath, 'PWNED')), 'command substitution executed');
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
});

check('symlinked .env refused as unsafe_config_file', () => {
  const outside = join(root, 'outside-env');
  writeFileSync(outside, readFileSync(join(deployPath, '.env'), 'utf8'));
  rmSync(join(deployPath, '.env'));
  symlinkSync(outside, join(deployPath, '.env'));
  const r = run();
  expect(r.status !== 0, 'symlink accepted');
  expect(JSON.parse(r.stdout).reason === 'unsafe_config_file', `reason=${JSON.parse(r.stdout).reason}`);
});

check('missing app refused (missing_or_multiple_app)', () => {
  const before = snap();
  const r = run({ SCENARIO: 'missing-app' });
  expect(r.status !== 0, 'missing app accepted');
  expect(JSON.parse(r.stdout).reason === 'missing_or_multiple_app', `reason=${JSON.parse(r.stdout).reason}`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
  assertReadOnly();
});

check('duplicate app refused', () => {
  const r = run({ SCENARIO: 'duplicate-app' });
  expect(r.status !== 0, 'duplicate app accepted');
  expect(JSON.parse(r.stdout).reason === 'missing_or_multiple_app', `reason=${JSON.parse(r.stdout).reason}`);
});

check('wrong port binding refused (wrong_backend_binding)', () => {
  const r = run({ SCENARIO: 'wrong-port' });
  expect(r.status !== 0, 'wrong port accepted');
  expect(JSON.parse(r.stdout).reason === 'wrong_backend_binding', `reason=${JSON.parse(r.stdout).reason}`);
});

check('unhealthy app refused', () => {
  const r = run({ SCENARIO: 'unhealthy-app' });
  expect(r.status !== 0, 'unhealthy accepted');
  expect(JSON.parse(r.stdout).reason === 'unhealthy_app', `reason=${JSON.parse(r.stdout).reason}`);
});

check('stopped app refused (wrong_serving_app)', () => {
  const r = run({ SCENARIO: 'stopped-app' });
  expect(r.status !== 0, 'stopped accepted');
  expect(JSON.parse(r.stdout).reason === 'wrong_serving_app', `reason=${JSON.parse(r.stdout).reason}`);
});

check('raw canary in docker version output fails validation, never emitted', () => {
  const r = run({ SCENARIO: 'raw-version-canary' });
  expect(r.status !== 0, 'canary version accepted');
  expect(JSON.parse(r.stdout).reason === 'docker_unavailable', `reason=${JSON.parse(r.stdout).reason}`);
  noCanary(r);
});

check('hung docker query bounded by timeout, stderr suppressed', () => {
  const before = snap();
  const start = Date.now();
  const r = run({ SCENARIO: 'timeout' });
  const elapsed = Date.now() - start;
  expect(r.status !== 0, 'timeout accepted');
  expect(JSON.parse(r.stdout).reason === 'docker_unavailable', `reason=${JSON.parse(r.stdout).reason}`);
  expect(elapsed < 15000, `took ${elapsed}ms`);
  expect(JSON.stringify(snap()) === JSON.stringify(before), 'state changed');
});

for (const [label, args] of [
  ['injection path', [`/opt/tokenizer'; touch ${'PWNED'}`, SHA]],
  ['dotdot path', ['/opt/tokenizer/../escape', SHA]],
  ['canary sha', [deployPath, CANARY]],
  ['missing args', []],
]) {
  check(`malicious remote args refused before any query: ${label}`, () => {
    const r = run({}, args);
    expect(r.status !== 0, 'bad args accepted');
    expect(JSON.parse(r.stdout).reason === 'invalid_input', `reason=${JSON.parse(r.stdout).reason}`);
    expect(calls().length === 0, `docker called: ${calls()}`);
  });
}

check('ambient DOCKER_HOST/proxy overrides are unset inside the script', () => {
  const r = run({ DOCKER_HOST: `tcp://${CANARY}`, COMPOSE_PROJECT_NAME: CANARY, HTTP_PROXY: `http://${CANARY}` });
  expect(r.status === 0, `exit=${r.status}`);
  noCanary(r);
});

const passed = results.filter(r => r.pass).length;
console.log(JSON.stringify({ suite: 'f003-host-preflight-probes', total: results.length, passed, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
