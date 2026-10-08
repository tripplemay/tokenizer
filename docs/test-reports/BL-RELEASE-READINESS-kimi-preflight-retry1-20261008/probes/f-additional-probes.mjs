// Additional independent Kimi retry1 probes (derived controls beyond the retained r0 set).
// F002: verify-vps-predecessor.sh extra negatives/positives.
// F003: vps-host-preflight.sh extra scenarios (network/volume/image-id/root-user/
//       revision variants, symlinked .releases, oversized env, path edge cases).
// Transport: extra workflow/static allowlist checks.
// F001: extra native-fixture scope statics and installer-gate negatives.
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.env.PROBE_BASE || '/private/tmp/kimi-pf-r1/probes';
const R2 = join(process.cwd(), 'scripts/verify-vps-predecessor.sh');
const R3 = join(process.cwd(), 'scripts/ci/vps-host-preflight.sh');
const CAND = 'c'.repeat(40), OLD = 'd'.repeat(40), SHA = 'c'.repeat(40), DEPLOYED = 'd'.repeat(40);
const APP_ID = `sha256:${'a'.repeat(64)}`;
const APP = `ghcr.io/probe/app@${APP_ID}`, MIG = `ghcr.io/probe/migrate@sha256:${'b'.repeat(64)}`;
const CANARY = 'KIMI_R1_ADDITIONAL_CANARY_NEVER_EMIT';
const results = [];
let root, deployPath;

function expect(cond, msg) { if (!cond) throw new Error(msg); }
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e) }); }
}
function snap(dir, prefix = '') {
  const out = {};
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'bin' || e.name === 'calls.log') continue;
    const p = join(dir, e.name), k = prefix + e.name;
    if (e.isSymbolicLink()) out[k] = 'SYMLINK';
    else if (e.isDirectory()) Object.assign(out, snap(p, `${k}/`));
    else out[k] = createHash('sha256').update(readFileSync(p)).digest('hex') + ':' + (statSync(p).mode & 0o7777).toString(8);
  }
  return out;
}
function stub(name, body) {
  const p = join(root, 'bin', name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}
function spawnBash(args, overrides = {}, cwd = root) {
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CALLS: join(root, 'calls.log'), ...overrides };
  spawnSync('bash', ['-c', 'true'], { encoding: 'utf8', env });
  const opts = { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024, env, cwd };
  let r = spawnSync('bash', args, opts);
  if (r.error && r.error.errno === -2) r = spawnSync('bash', args, opts);
  if (r.error) throw new Error(`spawn error: ${r.error.message}`);
  return r;
}
function noCanary(r) {
  expect(!String(r.stdout).includes(CANARY), 'canary in stdout');
  expect(!String(r.stderr).includes(CANARY), 'canary in stderr');
}

// ---------- F002 fixtures ----------
function fixtureF002() {
  root = mkdtempSync(join(BASE, 'r1f002-'));
  mkdirSync(join(root, 'bin')); mkdirSync(join(root, '.releases'));
  writeFileSync(join(root, '.env'), `GIT_COMMIT=${OLD}\nAPP_IMAGE=${APP}\nMIGRATE_IMAGE=${MIG}\nAPP_HOST_PORT=127.0.0.1:3010\nAUTH_SECRET=${CANARY}\n`);
  writeFileSync(join(root, 'docker-compose.yml'), 'services:\n  app: {}\n');
  writeFileSync(join(root, 'docker-compose.release.yml'), 'services:\n  app: {}\n');
  writeFileSync(join(root, '.releases', `${OLD}.manifest`), `commit=${OLD}\napp_image=${APP}\nmigrate_image=${MIG}\n`);
  writeFileSync(join(root, '.releases', `${OLD}.activated`), `commit=${OLD}\napp_image=${APP}\napp_id=${APP_ID}\n`);
  stub('docker', `printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  'image inspect --format {{.Id}} '*) echo "$PROBE_APP_ID" ;;
  *'config --quiet') exit 0 ;;
  *'config --format json') printf '{"name":"%s"}\\n' "\${PROBE_PROJECT:-tokenizer}" ;;
  *'ps -q app') printf '%s\\n' "\${PROBE_CONTAINER:-a1b2c3d4e5f6}" ;;
  inspect*) printf '%s\\n' "\${PROBE_DETAILS:-true|tokenizer|app|${APP_ID}}" ;;
  'port '*) printf '%s\\n' "\${PROBE_PORT:-127.0.0.1:3010}" ;;
  *) echo 'UNEXPECTED-MUTATION-ATTEMPT' >&2; exit 99 ;;
esac`);
  stub('curl', `if [ -n "\${PROBE_HEALTH+x}" ]; then printf '%s' "$PROBE_HEALTH"; else printf '{"ok":true,"code":"ready","commit":"%s"}' "${OLD}"; fi`);
}
function f002(name, fn) {
  fixtureF002();
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e) }); }
  rmSync(root, { recursive: true, force: true });
}
const runF002 = (mode = 'live', overrides = {}) =>
  spawnBash([R2, mode, CAND, APP, MIG], { OLD_SHA: OLD, PROBE_APP_ID: APP_ID, ...overrides });

f002('F002-x live: COMPOSE_PROJECT_NAME override in baseline refused, byte-identical', () => {
  writeFileSync(join(root, '.env'), `COMPOSE_PROJECT_NAME=evil\n${readFileSync(join(root, '.env'), 'utf8')}`);
  const before = snap(root);
  const r = runF002();
  expect(r.status !== 0, 'override accepted');
  expect(r.stderr.includes('explicit Compose project override'), `msg: ${r.stderr}`);
  expect(JSON.stringify(snap(root)) === JSON.stringify(before), 'state changed');
  noCanary(r);
});

f002('F002-x live: symlinked .env refused', () => {
  const outside = join(root, 'outside');
  writeFileSync(outside, readFileSync(join(root, '.env'), 'utf8'));
  rmSync(join(root, '.env'));
  symlinkSync(outside, join(root, '.env'));
  const r = runF002();
  expect(r.status !== 0, 'symlink accepted');
  expect(r.stderr.includes('current production environment is missing'), `msg: ${r.stderr}`);
});

f002('F002-x live: predecessor manifest/env mismatch refused', () => {
  writeFileSync(join(root, '.releases', `${OLD}.manifest`), `commit=${OLD}\napp_image=${APP}\nmigrate_image=ghcr.io/probe/other@sha256:${'9'.repeat(64)}\n`);
  const before = snap(root);
  const r = runF002();
  expect(r.status !== 0, 'mismatch accepted');
  expect(r.stderr.includes('predecessor manifest differs'), `msg: ${r.stderr}`);
  expect(JSON.stringify(snap(root)) === JSON.stringify(before), 'state changed');
});

f002('F002-x live: symlinked previous-env refused even with matching bytes', () => {
  const target = join(root, 'real-prev');
  writeFileSync(target, readFileSync(join(root, '.env'), 'utf8'));
  symlinkSync(target, join(root, '.releases', `${CAND}.previous-env`));
  const r = runF002();
  expect(r.status !== 0, 'symlinked previous-env accepted');
  expect(r.stderr.includes('does not match the current baseline'), `msg: ${r.stderr}`);
});

f002('F002-x live: old-format health with ok=false refused', () => {
  const r = runF002('live', { PROBE_HEALTH: `{"ok":false,"commit":"${OLD}"}` });
  expect(r.status !== 0, 'ok=false accepted');
  noCanary(r);
});

f002('F002-x retained: missing previous-env refused before candidate checks', () => {
  const r = runF002('retained');
  expect(r.status !== 0, 'missing previous-env accepted');
  expect(r.stderr.includes('retained predecessor environment is missing'), `msg: ${r.stderr}`);
});

f002('F002-x retained: candidate env wrong port refused', () => {
  const oldEnv = readFileSync(join(root, '.env'), 'utf8');
  writeFileSync(join(root, '.releases', `${CAND}.previous-env`), oldEnv);
  writeFileSync(join(root, '.env'), oldEnv.replace(OLD, CAND).replace('127.0.0.1:3010', '0.0.0.0:3010'));
  const before = snap(root);
  const r = runF002('retained');
  expect(r.status !== 0, 'wrong candidate port accepted');
  expect(r.stderr.includes('candidate backend port differs'), `msg: ${r.stderr}`);
  expect(JSON.stringify(snap(root)) === JSON.stringify(before), 'state changed');
});

f002('F002-x live: pre-existing identical candidate manifest accepted without rewrite', () => {
  const content = `commit=${CAND}\napp_image=${APP}\nmigrate_image=${MIG}\n`;
  writeFileSync(join(root, '.releases', `${CAND}.manifest`), content);
  chmodSync(join(root, '.releases', `${CAND}.manifest`), 0o444);
  const r = runF002();
  expect(r.status === 0, `exit=${r.status} err=${r.stderr}`);
  expect(readFileSync(join(root, '.releases', `${CAND}.manifest`), 'utf8') === content, 'manifest rewritten');
});

f002('F002-x live: missing APP_HOST_PORT refused as missing/duplicate', () => {
  writeFileSync(join(root, '.env'), readFileSync(join(root, '.env'), 'utf8').replace('APP_HOST_PORT=127.0.0.1:3010\n', ''));
  const r = runF002();
  expect(r.status !== 0, 'missing port accepted');
  expect(r.stderr.includes('missing or duplicate'), `msg: ${r.stderr}`);
});

// ---------- F003 fixtures ----------
function fixtureF003() {
  root = mkdtempSync(join(BASE, 'r1f003-'));
  deployPath = join(root, 'deploy');
  mkdirSync(join(root, 'bin')); mkdirSync(deployPath); mkdirSync(join(deployPath, '.releases'));
  writeFileSync(join(deployPath, '.env'),
    `GIT_COMMIT=${DEPLOYED}\nAPP_IMAGE=${APP}\nMIGRATE_IMAGE=${MIG}\nAPP_HOST_PORT=127.0.0.1:3010\nAUTH_SECRET=${CANARY}\n`);
  writeFileSync(join(deployPath, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(deployPath, 'docker-compose.release.yml'), 'services: {}\n');
  writeFileSync(join(deployPath, '.releases', `${DEPLOYED}.manifest`), `commit=${DEPLOYED}\napp_image=${APP}\nmigrate_image=${MIG}\n`);
  writeFileSync(join(deployPath, '.releases', `${DEPLOYED}.activated`), `commit=${DEPLOYED}\napp_image=${APP}\napp_id=${APP_ID}\n`);
  stub('timeout', `limit="$2"; shift 2
"$@" & pid=$!
( sleep "\${limit%s}"; kill -KILL "$pid" 2>/dev/null ) >/dev/null 2>&1 &
watcher=$!
wait "$pid" 2>/dev/null; status=$?
kill -KILL "$watcher" 2>/dev/null
exit $status`);
  stub('uname', 'if [ "$1" = -s ]; then echo Linux; else echo x86_64; fi');
  stub('df', "printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 100000 100 99900 1%% /x\\n'");
  stub('stat', `fmt="$2"; path="$4"
if [ "$fmt" = %s ]; then /usr/bin/stat -f%z "$path"; elif [ "$fmt" = %a ]; then /usr/bin/stat -f%Lp "$path"; else exit 99; fi`);
  stub('sha256sum', '/usr/bin/shasum -a 256 "$@"');
  stub('curl', `printf '%s' "$CANARY" >&2
if [ "\${SCENARIO:-}" = health-failure ]; then exit 7; fi
if [ -n "\${HEALTH_RAW:-}" ]; then printf '%s' "$HEALTH_RAW"; exit 0; fi
printf '{"ok":true,"code":"ready","commit":"%s"}' "${DEPLOYED}"`);
  stub('docker', `printf '%s\\n' "$*" >> "$CALLS"
printf '%s' "$CANARY" >&2
s="\${SCENARIO:-}"
case "$*" in
  'version --format {{.Server.Version}}') echo 27.5.1 ;;
  'compose version --short') echo 2.35.1 ;;
  *'service=app'*) echo a1b2c3d4e5f6 ;;
  *'service=postgres'*) [ "$s" = no-postgres ] && exit 0; echo b1c2d3e4f5a6 ;;
  'inspect --format {{.State.Running}}|'*)
    img="${APP_ID}"; [ "$s" = legacy-image ] && img=sha256:notdigest
    printf 'true|running|healthy|tokenizer|app|%s\\n' "$img" ;;
  'inspect --format {{.State.Status}}|'*) printf 'running|healthy|tokenizer|postgres|sha256:%s\\n' "${'b'.repeat(64)}" ;;
  'image inspect --format {{.Id}} '*)
    [ "$s" = wrong-image-id ] && echo "sha256:${'f'.repeat(64)}" || echo "${APP_ID}" ;;
  'image inspect --format {{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Config.User}} '*)
    printf '%s|%s\\n' "\${IMAGE_REVISION:-$DEPLOYED}" "\${IMAGE_USER-node}" ;;
  'inspect --format {{range $name, $_ := .NetworkSettings.Networks}}'*)
    case "$4" in
      b1c2d3e4f5a6) [ "$s" = wrong-pg-network ] && echo 'personal_net ' || echo 'tokenizer_default ' ;;
      *) [ "$s" = wrong-network ] && echo 'personal_net ' || echo 'tokenizer_default ' ;;
    esac ;;
  'inspect --format {{range .Mounts}}'*)
    [ "$s" = wrong-volume ] && echo 'personal_vol ' || echo 'tokenizer_postgres-data ' ;;
  'port '*) echo '127.0.0.1:3010' ;;
  'network inspect --format '*' tokenizer_default') echo 'tokenizer|bridge' ;;
  'volume inspect --format '*' tokenizer_postgres-data') echo 'tokenizer|local' ;;
  *) echo "UNEXPECTED-DOCKER-OP:$*" >&2; exit 99 ;;
esac`);
}
function f003(name, fn) {
  fixtureF003();
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e) }); }
  rmSync(root, { recursive: true, force: true });
}
const runF003 = (overrides = {}, args = null) =>
  spawnBash([R3, ...(args || [deployPath, SHA])], overrides);
const reason = (r) => JSON.parse(r.stdout).reason;
function readOnly() {
  if (!existsSync(join(root, 'calls.log'))) return;
  for (const line of readFileSync(join(root, 'calls.log'), 'utf8').trim().split('\n')) {
    expect(!/Config\.Env|\b(pull|push|run|exec|stop|start|restart|up|down|kill|login|logout|build|rm|prune|cp|create|tag|save|load|export|import|commit)\b/.test(line), `mutation op: ${line}`);
  }
}

f003('F003-x wrong app network refused (wrong_project_network)', () => {
  const before = snap(deployPath);
  const r = runF003({ SCENARIO: 'wrong-network' });
  expect(r.status !== 0 && reason(r) === 'wrong_project_network', `got ${r.status} ${r.stdout}`);
  expect(JSON.stringify(snap(deployPath)) === JSON.stringify(before), 'state changed');
  noCanary(r); readOnly();
});

f003('F003-x wrong postgres volume refused (wrong_project_volume)', () => {
  const r = runF003({ SCENARIO: 'wrong-volume' });
  expect(r.status !== 0 && reason(r) === 'wrong_project_volume', `got ${r.status} ${r.stdout}`);
  noCanary(r);
});

f003('F003-x wrong postgres network refused (wrong_project_network)', () => {
  const r = runF003({ SCENARIO: 'wrong-pg-network' });
  expect(r.status !== 0 && reason(r) === 'wrong_project_network', `got ${r.status} ${r.stdout}`);
});

f003('F003-x env image vs running image id mismatch refused (wrong_image_reference)', () => {
  const r = runF003({ SCENARIO: 'wrong-image-id' });
  expect(r.status !== 0 && reason(r) === 'wrong_image_reference', `got ${r.status} ${r.stdout}`);
});

f003('F003-x non-digest running image refused (wrong_serving_app)', () => {
  const r = runF003({ SCENARIO: 'legacy-image' });
  expect(r.status !== 0 && reason(r) === 'wrong_serving_app', `got ${r.status} ${r.stdout}`);
});

f003('F003-x health endpoint failure refused (backend_unavailable), stderr canary suppressed', () => {
  const r = runF003({ SCENARIO: 'health-failure' });
  expect(r.status !== 0 && reason(r) === 'backend_unavailable', `got ${r.status} ${r.stdout}`);
  noCanary(r);
});

f003('F003-x absent postgres still observed with unknown postgres fields', () => {
  const r = runF003({ SCENARIO: 'no-postgres' });
  expect(r.status === 0, `exit=${r.status} ${String(r.stdout).slice(0, 300)}`);
  const body = JSON.parse(r.stdout);
  expect(body.outcome === 'observed' && body.postgres.id === 'unknown' && body.postgres.volume === 'unknown', `pg: ${JSON.stringify(body.postgres)}`);
  expect(body.storage.volume_driver === 'unknown', 'volume driver should stay unknown without postgres');
});

f003('F003-x symlinked .releases directory refused (unsafe_release_directory)', () => {
  const real = join(root, 'real-releases');
  mkdirSync(real);
  rmSync(join(deployPath, '.releases'), { recursive: true });
  symlinkSync(real, join(deployPath, '.releases'));
  const r = runF003();
  expect(r.status !== 0 && reason(r) === 'unsafe_release_directory', `got ${r.status} ${r.stdout}`);
});

f003('F003-x oversized .env refused (oversized_config_file)', () => {
  writeFileSync(join(deployPath, '.env'), `${readFileSync(join(deployPath, '.env'), 'utf8')}${'x'.repeat(1048577)}\n`);
  const r = runF003();
  expect(r.status !== 0 && reason(r) === 'oversized_config_file', `got ${r.status} ${r.stdout}`);
});

f003('F003-x .env APP_HOST_PORT=0.0.0.0:3010 refused (invalid_setting)', () => {
  writeFileSync(join(deployPath, '.env'), readFileSync(join(deployPath, '.env'), 'utf8').replace('127.0.0.1:3010', '0.0.0.0:3010'));
  const before = snap(deployPath);
  const r = runF003();
  expect(r.status !== 0 && reason(r) === 'invalid_setting', `got ${r.status} ${r.stdout}`);
  expect(JSON.stringify(snap(deployPath)) === JSON.stringify(before), 'state changed');
});

f003('F003-x relative and traversal deploy paths refused before any query', () => {
  for (const bad of ['opt/tokenizer', '/opt/tokenizer/.', '/opt//tokenizer', `/opt/${'a'.repeat(260)}`]) {
    const r = runF003({}, [bad, SHA]);
    expect(r.status !== 0 && reason(r) === 'invalid_input', `path accepted: ${bad} -> ${r.status} ${r.stdout}`);
    expect(!existsSync(join(root, 'calls.log')), 'docker called on invalid path');
    rmSync(join(root, 'calls.log'), { force: true });
  }
});

f003('F003-x root image user and numeric uid user reported without failure', () => {
  let r = runF003({ IMAGE_USER: '' });
  // empty user -> docker prints trailing '|'; template yields empty user -> root/0
  expect(r.status === 0, `root user exit=${r.status} ${String(r.stdout).slice(0, 200)}`);
  let body = JSON.parse(r.stdout);
  expect(body.app.user === 'root' && body.app.uid === '0', `root mapping: ${JSON.stringify(body.app)}`);
  r = runF003({ IMAGE_USER: '1000:1000' });
  expect(r.status === 0, `numeric user exit=${r.status}`);
  body = JSON.parse(r.stdout);
  expect(body.app.user === '1000:1000' && body.app.uid === '1000', `uid mapping: ${JSON.stringify(body.app)}`);
});

f003('F003-x invalid OCI revision label refused (image_query_failed); <no value> tolerated', () => {
  let r = runF003({ IMAGE_REVISION: 'garbage-not-a-sha' });
  expect(r.status !== 0 && reason(r) === 'image_query_failed', `got ${r.status} ${r.stdout}`);
  r = runF003({ IMAGE_REVISION: '<no value>' });
  expect(r.status === 0, `<no value> exit=${r.status} ${String(r.stdout).slice(0, 200)}`);
  expect(JSON.parse(r.stdout).app.revision === 'unknown', 'revision should be unknown');
});

// ---------- transport / workflow statics ----------
const workflow = readFileSync('.github/workflows/deploy-vps.yml', 'utf8');
function jqFilter() {
  const marker = "if ! jq -e --arg source \"$GITHUB_SHA\" '";
  const start = workflow.indexOf(marker);
  const bodyStart = workflow.indexOf('def sha:', start);
  const end = workflow.indexOf(`' "$work/inventory.json" >/dev/null 2>&1; then`, bodyStart);
  return workflow.slice(bodyStart, end).replace(/\n {12}/g, '\n');
}
const filter = jqFilter();
const validReport = JSON.stringify({
  schema_version: 1, operation: 'host-preflight', source_sha: SHA, timestamp: '2026-10-08T00:00:00Z',
  outcome: 'observed', reason: 'none', project: 'tokenizer', baseline: 'digest_activated',
  platform: 'Linux/x86_64', free_kib: '99900',
  versions: { docker: '27.5.1', compose: '2.35.1' },
  settings: { GIT_COMMIT: DEPLOYED, APP_IMAGE: APP, MIGRATE_IMAGE: MIG, APP_HOST_PORT: '127.0.0.1:3010' },
  app: { id: 'a1b2c3d4e5f6', status: 'running', health: 'healthy', image_id: APP_ID, revision: DEPLOYED, user: 'node', uid: 'unknown', port: '127.0.0.1:3010', network: 'tokenizer_default' },
  postgres: { id: 'b1c2d3e4f5a6', status: 'running', health: 'healthy', image_id: `sha256:${'b'.repeat(64)}`, network: 'tokenizer_default', volume: 'tokenizer_postgres-data' },
  storage: { network: 'tokenizer_default', network_driver: 'bridge', volume: 'tokenizer_postgres-data', volume_driver: 'local' },
  files: { env: { sha256: 'a'.repeat(64), mode: '600' } }
});
const runFilter = (payload) =>
  spawnSync('jq', ['-e', '--arg', 'source', SHA, filter], { input: payload, encoding: 'utf8', timeout: 5000 }).status === 0;

check('T-x allowlist rejects unexpected files key and storage/network tampering', () => {
  let evil = JSON.parse(validReport);
  evil.files.postgres_data = { sha256: 'a'.repeat(64), mode: '600' };
  expect(!runFilter(JSON.stringify(evil)), 'extra files key accepted');
  evil = JSON.parse(validReport);
  evil.storage.network = 'personal_net';
  expect(!runFilter(JSON.stringify(evil)), 'wrong storage network accepted');
  evil = JSON.parse(validReport);
  evil.versions.extra = '1.0.0';
  expect(!runFilter(JSON.stringify(evil)), 'extra versions key accepted');
  evil = JSON.parse(validReport);
  evil.files.env.extra_field = CANARY;
  expect(!runFilter(JSON.stringify(evil)), 'extra file metadata key accepted');
});

check('T-x host-preflight transport: clean env, bounded report, artifact only redacted JSON', () => {
  const job = workflow.slice(workflow.indexOf('  host-preflight:\n'), workflow.indexOf('  verify:\n'));
  expect(job.includes('env -i PATH=/usr/local/bin:/usr/bin:/bin bash -s --'), 'clean env prefix missing');
  expect(job.includes('head -c 65537') && job.includes('> 65536'), 'report byte bound missing');
  expect(job.includes('timeout-minutes: 5'), 'job timeout missing');
  expect(job.includes('permissions:\n      contents: read'), 'job permissions not read-only');
  expect(job.includes('path: host-preflight-evidence/inventory.json'), 'artifact path widened');
  expect(job.includes('if-no-files-found: error'), 'artifact may be silently missing');
  expect(!/GITHUB_TOKEN|id-token|attestations|packages:/.test(job), 'token/registry capability in inventory job');
  expect(job.includes('jq -n --arg source "$source_sha"') && job.includes('"transport_failed"'), 'pre-seeded refusal placeholder missing');
});

check('T-x inventory script: stderr suppressed, no ledger writes, no sourced env, read-only docker', () => {
  const s = readFileSync(R3, 'utf8');
  expect(s.includes('exec 2>/dev/null'), 'stderr not suppressed');
  expect(!/source\s+\.?\.?env|^\s*\.\s+.*\.env/m.test(s), 'sources .env');
  expect(!/\b(mkdir|touch|cp|mv|rm|chmod|chown|ln|tee|install)\s/.test(s.replace(/chmod 600/g, '')), 'filesystem mutation in inventory script');
  expect(!/\.\releases\/\$\{?commit\}?\.(manifest|activated)\"?\s*>>?/.test(s), 'ledger write pattern');
  expect(!/docker\s+(pull|run|exec|stop|start|restart|login|logout|build|rm|create|cp|compose\s+(up|down|stop|restart))/m.test(s), 'mutating docker op');
  expect(s.includes("--noproxy '*'"), 'health query not pinned off proxy');
  expect(!/Config\.Env/.test(s), 'raw Config.Env inspected');
  const writes = s.split('\n').filter(l => /(^|\s)>\s*[^&]/.test(l) && !/2>\/dev\/null|2>&1|>\/dev\/null/.test(l));
  expect(writes.length === 0, `unexpected file redirections: ${writes.join(' | ')}`);
});

// ---------- F001 extras ----------
check('F001-x native fixture test uses only owned ci labels and RUNNER_TEMP-scoped roots', () => {
  const t = readFileSync('tests/cli/agent-release-installer-macos.test.ts', 'utf8');
  expect(t.includes('TOKENIZER_LAUNCHD_TEST_MODE'), 'test mode gate unused');
  expect((t.match(/cc\.tokenizer\.agent\.ci\./g) || []).length >= 1, 'no isolated ci label');
  const labels = [...t.matchAll(/cc\.tokenizer\.agent[A-Za-z0-9.-]*/g)].map(m => m[0]);
  for (const l of labels) expect(l === 'cc.tokenizer.agent' || l.startsWith('cc.tokenizer.agent.ci.'), `non-ci label in native fixture: ${l}`);
  expect(t.includes('mkdtempSync(join(tmpdir(), "tokenizer-macos-launchd-"))'), 'fixture root not tmpdir-scoped with the owned prefix');
  expect(!/launchctl", \["load"\]\s*\)\s*;?\s*(?!.*TOKENIZER_LAUNCHD_TEST)/.test(t), 'unguarded launchctl load');
});

check('F001-x workflow cleanup trap refuses out-of-scope fixture records', () => {
  const macJob = workflow.slice(workflow.indexOf('  verify-macos-agent:\n'), workflow.indexOf('  verify-db:\n'));
  expect(macJob.includes('TOKENIZER_FIXTURE_LABEL" != cc.tokenizer.agent.ci.*'), 'label scope check missing');
  expect(macJob.includes('Refusing an out-of-scope launchd fixture cleanup record'), 'refusal path missing');
  expect(macJob.includes('trap cleanup_native_fixture EXIT INT TERM'), 'cleanup trap missing');
  expect(!/sudo|\/Library\/LaunchDaemons/.test(macJob), 'privileged/system domain touched');
});

check('F001-x installer gate rejects reports with failed tests or missing assertion list', () => {
  const gate = 'scripts/ci/assert-macos-launchd-installer.mjs';
  const name = 'native macOS launchd pinned installer fixture installs and upgrades a live isolated service, restores it after failure, and rolls back offline without touching the default label';
  const base = { success: true, numFailedTests: 0, numPassedTests: 1, testResults: [{ assertionResults: [{ fullName: name, status: 'passed' }] }] };
  root = mkdtempSync(join(BASE, 'r1f001-'));
  const invoke = (body) => {
    const p = join(root, 'r.json');
    writeFileSync(p, JSON.stringify(body));
    return spawnSync(process.execPath, [gate, p], { encoding: 'utf8', timeout: 5000 });
  };
  expect(invoke({ ...base, numFailedTests: 1 }).status !== 0, 'failed test accepted');
  expect(invoke({ ...base, success: false }).status !== 0, 'unsuccessful run accepted');
  expect(invoke({ ...base, numPassedTests: 0 }).status !== 0, 'zero passes accepted');
  expect(invoke(base).status === 0, `valid rejected: ${invoke(base).stderr}`);
  rmSync(root, { recursive: true, force: true });
});

check('F001-x F001 transported paths present and service.ts launchd code matches 3d0a974 bytes', () => {
  const src = '3d0a974f4916c911917e1b09811c98d5c96b1ec0';
  for (const p of ['src/cli/service.ts', 'scripts/ci/assert-macos-launchd-installer.mjs', 'tests/ci/macos-launchd-cleanup-trap.test.ts', 'tests/ci/macos-launchd-installer-gate.test.ts', 'tests/cli/agent-release-installer-macos.test.ts', 'tests/cli/service-launchd.test.ts']) {
    const a = createHash('sha256').update(readFileSync(p)).digest('hex');
    const b = createHash('sha256').update(execFileSync('git', ['show', `${src}:${p}`])).digest('hex');
    expect(a === b, `${p} differs from 3d0a974 (${a} != ${b})`);
  }
});

const passed = results.filter(r => r.pass).length;
console.log(JSON.stringify({ suite: 'f-additional-probes-retry1', total: results.length, passed, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
