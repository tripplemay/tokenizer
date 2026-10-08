// Independent Kimi preflight probes for F003 transport/workflow layer:
// - extract the actual jq allowlist filter from .github/workflows/deploy-vps.yml and
//   run it against evaluator-crafted payloads (valid, extra keys, raw canary, wrong types)
// - static operation-separation checks (host-preflight never deploys; release gates preserved)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/deploy-vps.yml', 'utf8');
const SHA = 'c'.repeat(40);
const CANARY = 'KIMI_F003_TRANSPORT_CANARY';
const results = [];

function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e) }); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

// Extract the jq program from the inventory step verbatim (same anchoring the CI gate uses,
// derived independently here): starts at 'def sha:' and ends before the closing quote line.
function jqFilter() {
  const marker = "if ! jq -e --arg source \"$GITHUB_SHA\" '";
  const start = workflow.indexOf(marker);
  expect(start > 0, 'jq filter invocation not found in workflow');
  const bodyStart = workflow.indexOf("def sha:", start);
  const endMarker = `' "$work/inventory.json" >/dev/null 2>&1; then`;
  const end = workflow.indexOf(endMarker, bodyStart);
  expect(bodyStart > 0 && end > bodyStart, 'cannot slice jq filter');
  return workflow.slice(bodyStart, end).replace(/\n {12}/g, '\n');
}
const filter = jqFilter();
function runFilter(payload) {
  const r = spawnSync('jq', ['-e', '--arg', 'source', SHA, filter], { input: payload, encoding: 'utf8', timeout: 5000 });
  return r.status === 0;
}

const validReport = JSON.stringify({
  schema_version: 1, operation: 'host-preflight', source_sha: SHA, timestamp: '2026-10-08T00:00:00Z',
  outcome: 'observed', reason: 'none', project: 'tokenizer', baseline: 'digest_activated',
  platform: 'Linux/x86_64', free_kib: '99900',
  versions: { docker: '27.5.1', compose: '2.35.1' },
  settings: { GIT_COMMIT: 'd'.repeat(40), APP_IMAGE: `ghcr.io/x/app@sha256:${'a'.repeat(64)}`, MIGRATE_IMAGE: `ghcr.io/x/migrate@sha256:${'b'.repeat(64)}`, APP_HOST_PORT: '127.0.0.1:3010' },
  app: { id: 'a1b2c3d4e5f6', status: 'running', health: 'healthy', image_id: `sha256:${'a'.repeat(64)}`, revision: 'd'.repeat(40), user: 'node', uid: 'unknown', port: '127.0.0.1:3010', network: 'tokenizer_default' },
  postgres: { id: 'b1c2d3e4f5a6', status: 'running', health: 'healthy', image_id: `sha256:${'b'.repeat(64)}`, network: 'tokenizer_default', volume: 'tokenizer_postgres-data' },
  storage: { network: 'tokenizer_default', network_driver: 'bridge', volume: 'tokenizer_postgres-data', volume_driver: 'local' },
  files: { env: { sha256: 'a'.repeat(64), mode: '600' } }
});

check('allowlist filter accepts a well-formed observed report', () => {
  expect(runFilter(validReport), 'valid report rejected');
});

check('allowlist filter rejects unexpected report key carrying canary (Config.Env)', () => {
  const evil = JSON.parse(validReport);
  evil['Config.Env'] = [CANARY];
  expect(!runFilter(JSON.stringify(evil)), 'extra Config.Env key accepted');
});

check('allowlist filter rejects extra nested key under app', () => {
  const evil = JSON.parse(validReport);
  evil.app.env = [CANARY];
  expect(!runFilter(JSON.stringify(evil)), 'extra app.env accepted');
});

check('allowlist filter rejects canary smuggled into a free-form field', () => {
  const evil = JSON.parse(validReport);
  evil.reason = CANARY;
  expect(!runFilter(JSON.stringify(evil)), 'canary reason accepted');
  evil.reason = 'none'; evil.baseline = CANARY;
  expect(!runFilter(JSON.stringify(evil)), 'canary baseline accepted');
});

check('allowlist filter rejects wrong source_sha', () => {
  const evil = JSON.parse(validReport);
  evil.source_sha = 'd'.repeat(40);
  expect(!runFilter(JSON.stringify(evil)), 'wrong source accepted');
});

check('allowlist filter rejects malformed SHA / port / uid values', () => {
  for (const mutate of [
    (e) => { e.settings.GIT_COMMIT = 'ZZZ'; },
    (e) => { e.settings.APP_HOST_PORT = '0.0.0.0:3010'; },
    (e) => { e.app.uid = 'root'; },
    (e) => { e.postgres.status = 'running";danger'; },
    (e) => { e.files.env.sha256 = 'not-a-hash'; },
  ]) {
    const evil = JSON.parse(validReport);
    mutate(evil);
    expect(!runFilter(JSON.stringify(evil)), `malformed variant accepted: ${mutate}`);
  }
});

check('host-preflight job cannot reach deploy on any event, release gates preserved', () => {
  const job = workflow.slice(workflow.indexOf('  host-preflight:\n'), workflow.indexOf('  verify:\n'));
  expect(job.includes("if: github.event_name == 'workflow_dispatch' && inputs.operation == 'host-preflight'"), 'job gate missing');
  expect(!/npm ci|build-push|docker\/login|rsync|\bscp\b|rehearse-release|deploy-vps-release|verify-vps-predecessor|REGISTRY_TOKEN|AUTH_SECRET|POSTGRES_PASSWORD|attest/.test(job), 'deploy capability inside host-preflight job');
  expect(job.includes('< scripts/ci/vps-host-preflight.sh'), 'script not piped over stdin');
  expect(job.includes('timeout --signal=KILL 150s ssh'), 'ssh not bounded');
  expect(job.includes('StrictHostKeyChecking=yes'), 'host key checking missing');
  expect(!/scp|rsync/.test(job), 'file upload present');
  const deployJob = workflow.slice(workflow.indexOf('  deploy:\n'));
  expect(deployJob.includes("inputs.operation == 'release'"), 'deploy not restricted to release');
  for (const gate of ['verify:', 'verify-windows:', 'verify-macos-agent:', 'verify-db:', 'verify-browser:', 'release-artifact:']) {
    const section = workflow.slice(workflow.indexOf(`  ${gate}`), workflow.indexOf('  ', workflow.indexOf(`  ${gate}`) + 3) + 4000);
    expect(workflow.includes(`${gate}`), `missing ${gate}`);
  }
  expect(workflow.match(/if: github\.event_name != 'workflow_dispatch' \|\| inputs\.operation == 'release'/g).length >= 6, 'release gating missing on normal jobs');
  expect(workflow.includes('needs: [verify, verify-windows, verify-macos-agent, verify-db, verify-browser]'), 'release-artifact needs changed');
  expect(workflow.includes('needs: [verify, verify-windows, verify-macos-agent, verify-db, verify-browser, release-artifact]'), 'deploy needs changed');
  expect(workflow.includes('EVAL_B07_DB_URL:') && workflow.includes('EVAL_B06_DB_URL:'), 'B06/B07 PG16 env floor lost');
  expect(workflow.includes('postgres:16-alpine'), 'PG16 service lost');
  expect(workflow.includes('node scripts/ci/assert-vitest-results.mjs .ci/db-probes.json 15'), 'db probe no-skip floor lost');
  expect(workflow.includes('host-preflight') && workflow.includes('default: release'), 'dispatch input missing');
});

check('deploy job runs the predecessor guard BEFORE rsync and BEFORE env replacement', () => {
  const iPreflight = workflow.indexOf('- name: Verify live digest predecessor before remote mutation');
  const iRsync = workflow.indexOf('- name: Sync files to VPS');
  const iDeploy = workflow.indexOf('- name: Deploy on VPS');
  const iScp = workflow.indexOf('scp -i ~/.ssh/tokenizer_vps');
  const iRecheck = workflow.indexOf('Recheck after rsync');
  expect(0 < iPreflight && iPreflight < iRsync && iRsync < iDeploy && iDeploy < iScp, 'ordering broken');
  expect(iDeploy < iRecheck && iRecheck < iScp, 'post-rsync recheck missing before env copy');
  expect(workflow.slice(iPreflight, iRsync).includes('< scripts/verify-vps-predecessor.sh'), 'live preflight not piped');
});

const passed = results.filter(r => r.pass).length;
console.log(JSON.stringify({ suite: 'f003-transport-probes', total: results.length, passed, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
