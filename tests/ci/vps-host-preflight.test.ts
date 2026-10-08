import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sha = 'c'.repeat(40), deployed = 'd'.repeat(40);
const appId = 'a'.repeat(12), postgresId = 'b'.repeat(12);
const imageId = `sha256:${'a'.repeat(64)}`, postgresImageId = `sha256:${'b'.repeat(64)}`;
const appImage = `ghcr.io/test/app@${imageId}`, migrateImage = `ghcr.io/test/migrate@sha256:${'e'.repeat(64)}`;
const script = join(process.cwd(), 'scripts/ci/vps-host-preflight.sh');
const workflow = readFileSync('.github/workflows/deploy-vps.yml', 'utf8');
const canary = 'AUTH_SECRET_RAW_CANARY_DO_NOT_DISCLOSE';
let root: string, deployPath: string, bin: string;

function nodeTool(name: string, body: string) {
  const path = join(bin, name);
  writeFileSync(path, `#!${process.execPath}\n${body}\n`);
  chmodSync(path, 0o755);
}

function snapshot(directory = deployPath): unknown {
  return readdirSync(directory).sort().map((name) => {
    const path = join(directory, name), stat = statSync(path);
    return [name, stat.mode, stat.isDirectory() ? snapshot(path) : readFileSync(path).toString('hex')];
  });
}

function env(overrides: Record<string, string> = {}) {
  return { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: join(root, 'calls.jsonl'),
    DEPLOYED_SHA: deployed, APP_ID: appId, POSTGRES_ID: postgresId, IMAGE_ID: imageId,
    POSTGRES_IMAGE_ID: postgresImageId, SCENARIO: '', SECRET_CANARY: canary, ...overrides };
}

function run(overrides: Record<string, string> = {}, args = [deployPath, sha]) {
  return spawnSync('bash', [script, ...args], { env: env(overrides), encoding: 'utf8', timeout: 12_000 });
}

function report(result: ReturnType<typeof run>) {
  expect(result.stdout, result.stderr).not.toContain(canary);
  expect(result.stderr).not.toContain(canary);
  return JSON.parse(result.stdout);
}

function calls(): string[][] {
  return existsSync(join(root, 'calls.jsonl'))
    ? readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

function assertReadOnly() {
  for (const args of calls()) {
    expect(['version', 'compose', 'ps', 'inspect', 'image', 'port', 'network', 'volume']).toContain(args[0]);
    if (args[0] === 'compose') expect(args).toEqual(['compose', 'version', '--short']);
    if (['image', 'network', 'volume'].includes(args[0])) expect(args[1]).toBe('inspect');
    expect(args.join(' ')).not.toMatch(/Config\.Env|\b(pull|push|run|exec|stop|start|restart|up|down|kill|login|logout|build|rm|prune)\b/);
    if (args[0] === 'ps') {
      expect(args).toContain('label=com.docker.compose.project=tokenizer');
      expect(args).toContain('--filter');
    }
  }
}

function inventoryStep(): string {
  const start = workflow.indexOf('      - name: Collect bounded allowlisted inventory over SSH stdin\n');
  const body = workflow.indexOf('        run: |\n', start) + '        run: |\n'.length;
  const end = workflow.indexOf('      - name: Retain only redacted allowlisted host inventory\n', body);
  if (start < 0 || end < 0) throw new Error('missing host inventory workflow step');
  return workflow.slice(body, end).split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
}

function runWorkflow(stdout: string, overrides: Record<string, string> = {}) {
  const work = join(root, 'runner');
  mkdirSync(join(work, 'scripts/ci'), { recursive: true });
  copyFileSync(script, join(work, 'scripts/ci/vps-host-preflight.sh'));
  nodeTool('ssh-keyscan', `process.stderr.write(process.env.SECRET_CANARY); console.log('fixture-known-host ssh-ed25519 synthetic');`);
  nodeTool('ssh', `const fs=require('node:fs'),crypto=require('node:crypto');
    const input=fs.readFileSync(0);
    if(crypto.createHash('sha256').update(input).digest('hex')!==process.env.STDIN_HASH)process.exit(99);
    fs.appendFileSync(process.env.SSH_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');
    process.stderr.write(process.env.SECRET_CANARY);
    process.stdout.write(process.env.SSH_OUTPUT);
    process.exit(Number(process.env.SSH_STATUS||0));`);
  const result = spawnSync('bash', ['-c', inventoryStep()], { cwd: work, encoding: 'utf8', timeout: 12_000,
    env: env({ GITHUB_SHA: sha, VPS_HOST: 'host.example.test', VPS_USER: 'deployer', VPS_SSH_KEY: 'synthetic-private-key',
      VPS_SSH_PORT: '2222', VPS_DEPLOY_PATH: deployPath,
      SSH_OUTPUT: stdout, SSH_CALLS: join(root, 'ssh-calls.jsonl'),
      STDIN_HASH: createHash('sha256').update(readFileSync(script)).digest('hex'), ...overrides }) });
  return { result, artifact: readFileSync(join(work, 'host-preflight-evidence/inventory.json'), 'utf8') };
}

describe.skipIf(process.platform === 'win32')('read-only allowlisted tokenizer host preflight', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hp-'));
    deployPath = join(root, 'deploy'); bin = join(root, 'bin');
    mkdirSync(deployPath); mkdirSync(bin); mkdirSync(join(deployPath, '.releases'));
    const settings = `GIT_COMMIT=${deployed}\nAPP_IMAGE=${appImage}\nMIGRATE_IMAGE=${migrateImage}\nAPP_HOST_PORT=127.0.0.1:3010\nAUTH_SECRET=${canary}\nDATABASE_URL=postgresql://secret:password@example/secret\nHARNESS_CONSOLE_SIGNING_KEY=${canary}\n`;
    writeFileSync(join(deployPath, '.env'), settings);
    writeFileSync(join(deployPath, 'docker-compose.yml'), `services: {}\n# ${canary}\n`);
    writeFileSync(join(deployPath, 'docker-compose.release.yml'), 'services: {}\n');
    writeFileSync(join(deployPath, '.releases', `${deployed}.manifest`), `commit=${deployed}\napp_image=${appImage}\nmigrate_image=${migrateImage}\n`);
    writeFileSync(join(deployPath, '.releases', `${deployed}.activated`), `commit=${deployed}\napp_image=${appImage}\napp_id=${imageId}\n`);
    nodeTool('timeout', `const {spawnSync}=require('node:child_process');
      const args=process.argv.slice(2); if(args.shift()!=='--signal=KILL')process.exit(99);
      const limit=args.shift(); if(!/^[0-9]+s$/.test(limit))process.exit(99);
      const command=args.shift(),input=command==='ssh'?require('node:fs').readFileSync(0):undefined;
      const result=spawnSync(command,args,{input,encoding:'utf8',timeout:Number(limit.slice(0,-1))*1000,killSignal:'SIGKILL'});
      if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
      process.exit(result.error?.code==='ETIMEDOUT'?124:result.status??1);`);
    nodeTool('stat', `const fs=require('node:fs');const args=process.argv.slice(2),stat=fs.statSync(args.at(-1));
      if(args[1]==='%s')console.log(stat.size);else if(args[1]==='%a')console.log((stat.mode&0o7777).toString(8));else process.exit(99);`);
    nodeTool('uname', `console.log(process.argv[2]==='-s'?'Linux':'x86_64');`);
    nodeTool('df', `console.log('Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 100000 100 99900 1% /scope');`);
    nodeTool('curl', `const e=process.env;
      process.stderr.write(e.SECRET_CANARY);
      if(e.SCENARIO==='health-failure')process.exit(7);
      console.log(JSON.stringify({ok:e.SCENARIO!=='unready',code:e.SCENARIO==='null-health-code'?null:e.SCENARIO==='wrong-health-code'?'db_unavailable':'ready',
        commit:e.SCENARIO==='wrong-health-sha'?'c'.repeat(40):e.DEPLOYED_SHA,
        extra_secret:e.SECRET_CANARY}));`);
    nodeTool('docker', `const fs=require('node:fs');const a=process.argv.slice(2),e=process.env,s=e.SCENARIO;
      fs.appendFileSync(e.CALLS,JSON.stringify(a)+'\\n');
      process.stderr.write(e.SECRET_CANARY);
      if(e.DOCKER_HOST||e.DOCKER_CONTEXT||e.COMPOSE_PROJECT_NAME||e.HTTP_PROXY)process.exit(98);
      if(s==='timeout'&&a[0]==='version'){setTimeout(()=>process.exit(0),60000);return;}
      if(a[0]==='version'){console.log(s==='raw-canary'?e.SECRET_CANARY:'27.5.1');return;}
      if(a[0]==='compose'&&a[1]==='version'){console.log('2.35.1');return;}
      if(a[0]==='ps'){
        const app=a.some(x=>x.endsWith('service=app'));
        if(app&&s==='missing-app')return;
        console.log(app?(s==='duplicate-app'?e.APP_ID+'\\n'+'f'.repeat(12):e.APP_ID):e.POSTGRES_ID);return;
      }
      if(a[0]==='image'&&a[1]==='inspect'){
        if(a[3]==='{{.Id}}'){console.log(s==='wrong-image'?'sha256:'+'f'.repeat(64):e.IMAGE_ID);return;}
        console.log(e.DEPLOYED_SHA+'|'+(s==='raw-user-canary'?e.SECRET_CANARY:'node'));return;
      }
      if(a[0]==='inspect'){
        const app=a.at(-1)===e.APP_ID,format=a[2];
        if(format.includes('.NetworkSettings.Networks')){console.log(s==='wrong-network'?'personal_network':'tokenizer_default ');return;}
        if(format.includes('.Mounts')){console.log(s==='wrong-volume'?'personal_volume':'tokenizer_postgres-data ');return;}
        const project=s==='wrong-project'?'unrelated':'tokenizer',service=app?(s==='wrong-service'?'postgres':'app'):'postgres';
        const health=app&&s==='unhealthy-app'?'unhealthy':'healthy';
        console.log((app?((s==='stopped-app'?'false':'true')+'|'):'')+'running|'+health+'|'+project+'|'+service+'|'+(app?e.IMAGE_ID:e.POSTGRES_IMAGE_ID));return;
      }
      if(a[0]==='port'){console.log(s==='wrong-port'?'0.0.0.0:3010':'127.0.0.1:3010');return;}
      if(a[0]==='network'&&a[1]==='inspect'){console.log('tokenizer|bridge');return;}
      if(a[0]==='volume'&&a[1]==='inspect'){console.log('tokenizer|local');return;}
      process.exit(99);`);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('inventories an activated digest baseline with hashes and no raw config, DB, stderr, or mutations', () => {
    const before = snapshot(), result = run();
    expect(result.status, result.stderr).toBe(0);
    const body = report(result);
    expect(body).toMatchObject({ outcome: 'observed', baseline: 'digest_activated', source_sha: sha,
      project: 'tokenizer', settings: { GIT_COMMIT: deployed }, app: { id: appId, user: 'node', uid: 'unknown' },
      postgres: { id: postgresId, volume: 'tokenizer_postgres-data' } });
    expect(body.files.env.sha256).toBe(createHash('sha256').update(readFileSync(join(deployPath, '.env'))).digest('hex'));
    expect(result.stdout).not.toMatch(/DATABASE_URL|AUTH_SECRET|Config\.Env|extra_secret|password@example/);
    expect(snapshot()).toEqual(before); assertReadOnly();
  });

  it('reports a healthy legacy source image and missing ledger as legacy, never creates activation', () => {
    const path = join(deployPath, '.env');
    writeFileSync(path, readFileSync(path, 'utf8').replace(appImage, 'tokenizer-app:legacy').replace(migrateImage, 'tokenizer-migrate:legacy'));
    rmSync(join(deployPath, '.releases'), { recursive: true });
    const before = snapshot(), result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(report(result)).toMatchObject({ baseline: 'legacy_or_unknown', files: { releases: { sha256: 'missing' } } });
    expect(snapshot()).toEqual(before); assertReadOnly();
  });

  it.each(['missing-app','duplicate-app','wrong-project','wrong-service','stopped-app','unhealthy-app','wrong-port',
    'wrong-image','wrong-network','wrong-volume','unready','wrong-health-code','null-health-code','wrong-health-sha','health-failure','raw-canary','raw-user-canary'])
    ('refuses %s without writes or disclosure', (scenario) => {
      const before = snapshot(), result = run({ SCENARIO: scenario });
      expect(result.status).not.toBe(0);
      expect(report(result).outcome).toBe('refused');
      expect(snapshot()).toEqual(before); assertReadOnly();
    });

  it('bounds a hung query to five seconds and suppresses its failed stderr', () => {
    const before = snapshot(), start = Date.now(), result = run({ SCENARIO: 'timeout' });
    expect(result.status).not.toBe(0);
    expect(Date.now() - start).toBeLessThan(9_000);
    expect(report(result).reason).toBe('docker_unavailable');
    expect(snapshot()).toEqual(before); assertReadOnly();
  }, 12_000);

  it('does not execute config content and clears Docker/Compose/proxy environment overrides', () => {
    writeFileSync(join(deployPath, '.env'), `${readFileSync(join(deployPath, '.env'))}AUTH_SECRET=$(touch injected)\n`);
    const before = snapshot(), result = run({ DOCKER_HOST: 'tcp://secret-canary', DOCKER_CONTEXT: canary,
      COMPOSE_PROJECT_NAME: canary, HTTP_PROXY: 'http://secret-canary' });
    expect(result.status, result.stderr).toBe(0);
    report(result); expect(snapshot()).toEqual(before); assertReadOnly();
    expect(existsSync(join(deployPath, 'injected'))).toBe(false);
  });

  it.each(['duplicate','malicious-image','symlink','oversized'])('refuses unsafe selected configuration: %s', (kind) => {
    const path = join(deployPath, '.env'), original = readFileSync(path, 'utf8');
    if (kind === 'duplicate') writeFileSync(path, `${original}GIT_COMMIT=${deployed}\n`);
    if (kind === 'malicious-image') writeFileSync(path, original.replace(appImage, `$(touch ${canary})`));
    if (kind === 'symlink') { writeFileSync(join(root, 'outside-env'), original); rmSync(path); symlinkSync(join(root, 'outside-env'), path); }
    if (kind === 'oversized') writeFileSync(path, `${original}${'x'.repeat(1048577)}`);
    const before = snapshot(), result = run();
    expect(result.status).not.toBe(0); report(result);
    expect(snapshot()).toEqual(before); assertReadOnly();
  });

  it.each([
    { args: ["/opt/tokenizer'; touch injected", sha] }, { args: ['/opt/tokenizer/../other', sha] },
    { args: ['/opt/tokenizer', canary] }, { args: [] }
  ])('rejects malicious/missing remote args before queries %#', ({ args }) => {
    const result = run({}, args);
    expect(result.status).not.toBe(0);
    expect(report(result).reason).toBe('invalid_input');
    expect(calls()).toEqual([]);
  });

  it('transports the exact reviewed script on stdin and uploads only validated JSON', () => {
    const remote = run(); expect(remote.status).toBe(0);
    const step = inventoryStep();
    const filter = step.slice(step.indexOf('def sha:')).split(/\n\s*' "\$work\/inventory\.json"/)[0];
    const gate = spawnSync('jq', ['-e', '--arg', 'source', sha, filter], { input: remote.stdout, encoding: 'utf8' });
    expect(gate.status, `${gate.stderr}\n${remote.stdout}`).toBe(0);
    const before = snapshot(), { result, artifact } = runWorkflow(remote.stdout);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(artifact).source_sha).toBe(sha);
    expect(`${artifact}${result.stdout}${result.stderr}`).not.toContain(canary);
    const sshArgs = JSON.parse(readFileSync(join(root, 'ssh-calls.jsonl'), 'utf8')) as string[];
    expect(sshArgs.at(-1)).toContain(`bash -s -- '${deployPath}' '${sha}'`);
    expect(sshArgs).toContain('StrictHostKeyChecking=yes');
    expect(snapshot()).toEqual(before); assertReadOnly();
  });

  it.each([
    { VPS_HOST: "host'; touch injected" }, { VPS_USER: '-option' }, { VPS_SSH_PORT: '22;echo bad' },
    { VPS_SSH_PORT: '0' }, { VPS_SSH_PORT: '65536' }, { VPS_DEPLOY_PATH: '/opt/../personal' },
    { VPS_DEPLOY_PATH: '/opt/tokenizer\nsecret' }, { VPS_SSH_KEY: '' }
  ])('refuses invalid SSH input before an SSH invocation %#', (overrides) => {
    const { result, artifact } = runWorkflow('{}', overrides);
    expect(result.status).not.toBe(0);
    expect(existsSync(join(root, 'ssh-calls.jsonl'))).toBe(false);
    expect(JSON.parse(artifact).outcome).toBe('refused');
    expect(`${artifact}${result.stderr}`).not.toContain(canary);
  });

  it.each(['raw-stdout', 'extra-key', 'failed-transport'])('never retains unallowlisted or failed transport bytes: %s', (kind) => {
    const remote = run(), body = JSON.parse(remote.stdout);
    const output = kind === 'raw-stdout' ? canary : kind === 'extra-key' ? JSON.stringify({ ...body, 'Config.Env': [canary] }) : '';
    const { result, artifact } = runWorkflow(output, { SSH_STATUS: kind === 'failed-transport' ? '255' : '0' });
    expect(result.status).not.toBe(0);
    expect(JSON.parse(artifact)).toMatchObject({ outcome: 'refused', reason: 'transport_failed' });
    expect(`${artifact}${result.stdout}${result.stderr}`).not.toContain(canary);
  });

  it('retains a valid redacted refusal while returning nonzero', () => {
    const remote = run({ SCENARIO: 'missing-app' });
    const { result, artifact } = runWorkflow(remote.stdout, { SSH_STATUS: '1' });
    expect(result.status).not.toBe(0);
    expect(JSON.parse(artifact)).toMatchObject({ outcome: 'refused', reason: 'missing_or_multiple_app' });
    expect(`${artifact}${result.stderr}`).not.toContain(canary);
  });
});

describe('host-preflight operation separation and preserved release gates', () => {
  it('dispatches inventory alone even on main, and preserves push/PR/release gates', () => {
    const gates = ['verify','verify-windows','verify-macos-agent','verify-db','verify-browser','release-artifact'];
    for (const name of gates) {
      const job = workflow.slice(workflow.indexOf(`  ${name}:\n`)).split(/\n  [a-z][a-z-]+:\n/)[0];
      expect(job).toContain("if: github.event_name != 'workflow_dispatch' || inputs.operation == 'release'");
    }
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.operation == 'host-preflight'");
    expect(workflow).toContain("(github.event_name == 'workflow_dispatch' && inputs.operation == 'release')");
    for (const [event, operation, release, inventory] of [
      ['push', undefined, true, false], ['pull_request', undefined, true, false],
      ['workflow_dispatch', 'release', true, false], ['workflow_dispatch', 'host-preflight', false, true],
      ['workflow_dispatch', 'unknown', false, false]
    ]) {
      expect(event !== 'workflow_dispatch' || operation === 'release').toBe(release);
      expect(event === 'workflow_dispatch' && operation === 'host-preflight').toBe(inventory);
    }
    const job = workflow.slice(workflow.indexOf('  host-preflight:\n'), workflow.indexOf('  verify:\n'));
    expect(job).not.toMatch(/npm ci|build-push|docker\/login|rsync|\bscp\b|rehearse-release|migrate deploy|deploy-vps-release|REGISTRY_TOKEN|AUTH_SECRET|POSTGRES_PASSWORD/);
    expect(job).toContain('< scripts/ci/vps-host-preflight.sh');
    expect(job).toContain('timeout --signal=KILL 150s ssh');
    expect(job).toContain('path: host-preflight-evidence/inventory.json');
    expect(workflow).toContain('EVAL_B07_DB_URL:');
    expect(workflow).toContain('tests/server/b06-partial-ack-db.probe.test.ts');
    expect(workflow).toContain('tests/server/b07-queue-id-ack-db.probe.test.ts');
    expect(workflow).toContain('node scripts/ci/assert-vitest-results.mjs .ci/db-probes.json 15');
    expect(workflow).toContain('needs: [verify, verify-windows, verify-macos-agent, verify-db, verify-browser, release-artifact]');
  });
});
