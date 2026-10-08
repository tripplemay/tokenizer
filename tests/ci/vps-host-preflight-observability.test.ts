import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const base = 'a5ea6e3f66ab4b4b831de88a6bcb078f444b2aca';
const sha = 'c'.repeat(40);
const scriptPath = 'scripts/ci/vps-host-preflight.sh';
const workflowPath = '.github/workflows/deploy-vps.yml';
const script = readFileSync(scriptPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');
const secret = 'SECRET_OUTPUT_CANARY_NEVER_RETAIN';
const homeCanary = '/synthetic/HOME_PATH_CANARY_NEVER_RETAIN';
let root: string, bin: string, deploy: string;

function baseline(path: string) {
  const result = spawnSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function validator(source: string) {
  const marker = "          if ! jq -e --arg source \"$GITHUB_SHA\" '\n";
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf("          ' \"$work/inventory.json\" >/dev/null 2>&1; then", start);
  if (start < marker.length || end < start) throw new Error('missing real host validator');
  return { filter: source.slice(start, end), outside: `${source.slice(0, start)}<FILTER>${source.slice(end)}` };
}

function gate(body: unknown) {
  return spawnSync('jq', ['-e', '--arg', 'source', sha, validator(workflow).filter], {
    input: JSON.stringify(body), encoding: 'utf8', env: { PATH: '/usr/bin:/bin', NODE_ENV: 'test' }
  });
}

function tool(name: string, body: string) {
  const path = join(bin, name);
  writeFileSync(path, `#!${process.execPath}\nconst fs=require('node:fs'),a=process.argv.slice(2),e=process.env;\nfs.appendFileSync(e.CALLS,JSON.stringify([${JSON.stringify(name)},...a])+'\\n');\n${body}\n`);
  chmodSync(path, 0o755);
}

function snapshot(directory = deploy): unknown {
  return readdirSync(directory).sort().map((name) => {
    const path = join(directory, name), stat = statSync(path);
    return [name, stat.mode, stat.isDirectory() ? snapshot(path) : readFileSync(path).toString('hex')];
  });
}

function calls(): string[][] {
  const path = join(root, 'calls');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

type Probe = { status: string; pipeline_exit_status: number | null; captured_bytes: number | null; home_present: boolean };
function run(options: { output?: string; code?: number; pipelineCode?: number; headCode?: number; hang?: boolean; home?: string; early?: string; args?: string[]; source?: string; validate?: boolean } = {}) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PATH: `${bin}:/usr/bin:/bin`, CALLS: join(root, 'calls'), LC_ALL: 'en_US.UTF-8',
    OUTPUT: Buffer.from(options.output ?? 'v2.35.1\n').toString('base64'), CODE: String(options.code ?? 0),
    PIPELINE_CODE: options.pipelineCode === undefined ? '' : String(options.pipelineCode),
    HEAD_CODE: options.headCode === undefined ? '' : String(options.headCode),
    HANG: options.hang ? '1' : '', EARLY: options.early ?? '', CANARY: secret
  };
  if (options.home !== undefined) env.HOME = options.home;
  const before = snapshot();
  const result = spawnSync('/bin/bash', [options.source ?? join(process.cwd(), scriptPath), ...(options.args ?? [deploy, sha])], {
    env, encoding: 'utf8', timeout: 10_000
  });
  expect(result.error).toBeUndefined();
  expect(result.stdout + result.stderr).not.toContain(secret);
  expect(result.stdout + result.stderr).not.toContain(homeCanary);
  expect(result.stderr).toBe('');
  expect(snapshot()).toEqual(before);
  const body = JSON.parse(result.stdout);
  if (options.validate !== false) expect(gate(body).status, JSON.stringify(body)).toBe(0);
  return { result, body, probe: body.compose_probe as Probe, calls: calls() };
}

function expectComposeRefusal(value: ReturnType<typeof run>, probe: Probe) {
  expect(value.result.status).toBe(1);
  expect(value.body).toMatchObject({ outcome: 'refused', reason: 'compose_unavailable', versions: { compose: 'unknown' } });
  expect(value.probe).toEqual(probe);
  expect(value.calls.filter(([name]) => name === 'timeout')).toEqual([
    ['timeout', '--signal=KILL', '5s', 'uname', '-s'],
    ['timeout', '--signal=KILL', '5s', 'uname', '-m'],
    ['timeout', '--signal=KILL', '5s', 'df', '-Pk', '--', deploy],
    ['timeout', '--signal=KILL', '5s', 'docker', 'version', '--format', '{{.Server.Version}}'],
    ['timeout', '--signal=KILL', '5s', 'docker', 'compose', 'version', '--short']
  ]);
  expect(value.calls.filter(([name]) => name === 'docker')).toEqual([
    ['docker', 'version', '--format', '{{.Server.Version}}'], ['docker', 'compose', 'version', '--short']
  ]);
  expect(value.calls.filter(([name]) => name === 'head')).toEqual(Array.from({ length: 5 }, () => ['head', '-c', '16385']));
  expect(value.calls.some(([name]) => ['stat', 'sha256sum', 'curl'].includes(name))).toBe(false);
  expect(value.body.files).toEqual({});
}

describe.skipIf(process.platform === 'win32')('fixed Compose-only preflight observability', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hpo-')); bin = join(root, 'bin'); deploy = join(root, 'deploy');
    mkdirSync(bin); mkdirSync(deploy);
    writeFileSync(join(deploy, '.env'), `AUTH_SECRET=${secret}\n`);
    writeFileSync(join(deploy, 'docker-compose.yml'), `# ${secret}\nservices: {}\n`);
    tool('timeout', `const {spawnSync}=require('node:child_process');
      if(a.shift()!=='--signal=KILL'||a.shift()!=='5s')process.exit(99);
      const command=a.shift(),r=spawnSync(command,a,{timeout:5000,killSignal:'SIGKILL'});
      const code=command==='docker'&&a[0]==='compose'&&e.PIPELINE_CODE!==''?Number(e.PIPELINE_CODE):r.error?.code==='ETIMEDOUT'?124:r.status??1;
      if(r.stderr)process.stderr.write(r.stderr);
      process.stdout.on('error',()=>process.exit(code));
      process.stdout.write(r.stdout||Buffer.alloc(0),()=>process.exit(code));`);
    tool('head', `const {spawnSync}=require('node:child_process');
      const input=fs.readFileSync(0),r=spawnSync('/usr/bin/head',a,{input});
      const code=e.HEAD_CODE!==''&&input.equals(Buffer.from(e.OUTPUT,'base64'))?Number(e.HEAD_CODE):r.status??1;
      process.stdout.write(r.stdout);process.exit(code);`);
    tool('uname', `if(e.EARLY==='platform')process.exit(4);console.log(a[0]==='-s'?'Linux':'x86_64');`);
    tool('df', `console.log(e.EARLY==='space'?'invalid':'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 100000 100 99900 1% /scope');`);
    tool('stat', `const s=fs.statSync(a.at(-1));console.log(a[1]==='%s'?s.size:(s.mode&0o7777).toString(8));`);
    tool('sha256sum', `console.log(require('node:crypto').createHash('sha256').update(fs.readFileSync(a.at(-1))).digest('hex')+'  fixture');`);
    tool('curl', `process.exit(99);`);
    tool('docker', `process.stderr.write(e.CANARY);
      if(a[0]==='version'){if(e.EARLY==='docker')process.exit(3);console.log('29.1.3');return;}
      if(JSON.stringify(a)===JSON.stringify(['compose','version','--short'])){
        if(e.HANG){setTimeout(()=>process.exit(0),60000);return;}
        process.stdout.write(Buffer.from(e.OUTPUT,'base64'),()=>process.exit(Number(e.CODE)));return;
      }
      if(a[0]==='ps')return;
      process.exit(99);`);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([undefined, '', homeCanary])('records HOME presence only, including empty HOME %#', (home) => {
    const value = run({ home, output: 'v2.35.1\n\n\n' });
    expect(value.probe).toEqual({ status: 'ok', pipeline_exit_status: 0, captured_bytes: 7, home_present: home !== undefined });
    expect(value.body.versions.compose).toBe('v2.35.1');
    expect(value.body.reason).toBe('missing_or_multiple_app');
    expect(value.calls.filter(([name]) => name === 'docker').at(-1)).toEqual([
      'docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=tokenizer', '--filter', 'label=com.docker.compose.service=app', '--format', '{{.ID}}'
    ]);
  });

  it.each([1, 23, 124, 137, 141, 255])('retains whole bounded pipeline status %i without cause inference', (code) => {
    expectComposeRefusal(run({ pipelineCode: code, output: `${secret}\n\n` }), {
      status: 'command_failed', pipeline_exit_status: code, captured_bytes: Buffer.byteLength(secret), home_present: false
    });
  });

  it('records command failure even when stdout is valid semver', () => {
    expectComposeRefusal(run({ code: 7, output: '2.35.1\n' }), {
      status: 'command_failed', pipeline_exit_status: 7, captured_bytes: 6, home_present: false
    });
  });

  it('records the rightmost failing capture stage, not necessarily the Docker exit code', () => {
    expectComposeRefusal(run({ code: 7, headCode: 141, output: 'v2.35.1\n' }), {
      status: 'command_failed', pipeline_exit_status: 141, captured_bytes: 7, home_present: false
    });
  });

  it.each(['', `${secret}\n`, 'v2.35.1\ninvalid'])('refuses invalid retained versions with no disclosure %#', (output) => {
    expectComposeRefusal(run({ output }), {
      status: 'invalid_version', pipeline_exit_status: 0, captured_bytes: Buffer.byteLength(output.replace(/\n+$/, '')), home_present: false
    });
  });

  it.each([0, 23, 141])('prioritizes the existing retained output cap over pipeline status %i', (pipelineCode) => {
    expectComposeRefusal(run({ output: 'x'.repeat(20000), pipelineCode }), {
      status: 'output_bound_exceeded', pipeline_exit_status: pipelineCode, captured_bytes: 16385, home_present: false
    });
  });

  it('counts UTF-8 retained bytes rather than characters under a multibyte locale', () => {
    expectComposeRefusal(run({ output: `${'\u00e9'.repeat(8192)}\n\n` }), {
      status: 'invalid_version', pipeline_exit_status: 0, captured_bytes: 16384, home_present: false
    });
  });

  it('measures stripped retained bytes rather than total stdout at the cap', () => {
    expectComposeRefusal(run({ output: `${'x'.repeat(16384)}\n\n\n` }), {
      status: 'invalid_version', pipeline_exit_status: 0, captured_bytes: 16384, home_present: false
    });
  });

  it('refuses a multibyte string at the byte cap, including a truncated final code point', () => {
    expectComposeRefusal(run({ output: '\u00e9'.repeat(10000) }), {
      status: 'output_bound_exceeded', pipeline_exit_status: 0, captured_bytes: 16385, home_present: false
    });
  });

  it('bounds a hung Compose capture using the unchanged query argv', () => {
    const start = Date.now();
    expectComposeRefusal(run({ hang: true }), { status: 'command_failed', pipeline_exit_status: 124, captured_bytes: 0, home_present: false });
    expect(Date.now() - start).toBeLessThan(9_000);
  }, 12_000);

  it.each(['platform', 'space', 'docker'])('leaves metrics null before Compose on %s refusal', (early) => {
    const value = run({ early, home: '' });
    expect(value.probe).toEqual({ status: 'not_run', pipeline_exit_status: null, captured_bytes: null, home_present: true });
    expect(value.calls.some((args) => args.includes('compose'))).toBe(false);
    expect(value.result.status).toBe(1);
  });

  it('keeps the invalid-input full report before all queries', () => {
    const value = run({ args: ['/invalid/../path', sha], validate: false });
    // The old invalid-input branch deliberately clears source_sha.
    expect(value.body.reason).toBe('invalid_input');
    expect(gate(value.body).status).not.toBe(0);
    expect(value.calls).toEqual([]);
    expect(value.probe).toEqual({ status: 'not_run', pipeline_exit_status: null, captured_bytes: null, home_present: false });
  });

  it('preserves non-Compose query argv, redacted fields and no mutation against the base', () => {
    const before = snapshot();
    const candidate = run();
    rmSync(join(root, 'calls'));
    const original = join(root, 'baseline.sh'); writeFileSync(original, baseline(scriptPath));
    // The baseline lacks compose_probe, so its report is not passed to the new validator.
    const result = spawnSync('/bin/bash', [original, deploy, sha], {
      env: { NODE_ENV: 'test', PATH: `${bin}:/usr/bin:/bin`, CALLS: join(root, 'calls'),
        OUTPUT: Buffer.from('v2.35.1\n').toString('base64'), CODE: '0', PIPELINE_CODE: '', HEAD_CODE: '',
        HANG: '', EARLY: '', LC_ALL: 'en_US.UTF-8', CANARY: secret },
      encoding: 'utf8', timeout: 10_000
    });
    expect(result.status).toBe(candidate.result.status);
    expect(result.stdout + result.stderr).not.toContain(secret);
    const { compose_probe: _probe, timestamp: _timestamp, ...body } = candidate.body;
    const { timestamp: _originalTimestamp, ...oldBody } = JSON.parse(result.stdout);
    expect(body).toEqual(oldBody);
    expect(calls().map((args) => JSON.stringify(args)).sort()).toEqual(candidate.calls.map((args) => JSON.stringify(args)).sort());
    expect(snapshot()).toEqual(before);
  });

  it('keeps the missing-jq minimal refusal unchanged and outside full transport reports', () => {
    const date = join(bin, 'date');
    writeFileSync(date, '#!/bin/bash\nprintf "2026-10-09T00:00:00Z\\n"\n'); chmodSync(date, 0o755);
    const result = spawnSync('/bin/bash', [join(process.cwd(), scriptPath), deploy, sha], {
      env: { PATH: bin, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000
    });
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body).toEqual({ schema_version: 1, operation: 'host-preflight', outcome: 'refused', reason: 'missing_tools' });
    expect(gate(body).status).not.toBe(0);
  });

  it('validates each fixed classification using the actual workflow filter', () => {
    const body = run().body;
    for (const probe of [
      { status: 'not_run', pipeline_exit_status: null, captured_bytes: null, home_present: false },
      { status: 'ok', pipeline_exit_status: 0, captured_bytes: 0, home_present: true },
      { status: 'invalid_version', pipeline_exit_status: 0, captured_bytes: 16384, home_present: false },
      { status: 'command_failed', pipeline_exit_status: 255, captured_bytes: 16384, home_present: false },
      { status: 'output_bound_exceeded', pipeline_exit_status: 141, captured_bytes: 16385, home_present: true }
    ]) expect(gate({ ...body, compose_probe: probe }).status, JSON.stringify(probe)).toBe(0);
  });

  it('rejects missing, extra, wrong type, enum, range and null-relation metadata with the actual filter', () => {
    const body = run().body, good = body.compose_probe;
    const bad: unknown[] = [undefined, null, [], secret, 0, true, {}, { ...good, secret },
      ...Object.keys(good).map((key) => Object.fromEntries(Object.entries(good).filter(([name]) => name !== key))),
      ...[null, false, 0, secret, 'timeout', 'missing_plugin'].map((status) => ({ ...good, status })),
      ...[null, -1, 256, 0.5, '0', false, [], {}, secret].map((pipeline_exit_status) => ({ ...good, pipeline_exit_status })),
      ...[null, -1, 16385, 0.5, '7', true, [], {}, secret].map((captured_bytes) => ({ ...good, captured_bytes })),
      ...[null, 0, 'false', [], {}, homeCanary].map((home_present) => ({ ...good, home_present })),
      { ...good, status: 'not_run' }, { ...good, status: 'not_run', pipeline_exit_status: null },
      { ...good, status: 'not_run', captured_bytes: null }, { ...good, status: 'command_failed' },
      { ...good, status: 'output_bound_exceeded' },
      { ...good, status: 'output_bound_exceeded', captured_bytes: 16386 },
      { ...good, status: 'output_bound_exceeded', captured_bytes: 16385, pipeline_exit_status: null },
      { ...good, status: 'invalid_version', pipeline_exit_status: 1 }
    ];
    for (const compose_probe of bad) expect(gate({ ...body, compose_probe }).status, JSON.stringify(compose_probe)).not.toBe(0);
    for (const addition of [{ ...body, secret }, { ...body, versions: { ...body.versions, secret } },
      { ...body, files: { ...body.files, secret: { sha256: secret, mode: '600' } } }]) {
      expect(gate(addition).status).not.toBe(0);
    }
  });
});

describe('byte-frozen host-preflight boundaries', () => {
  it('pins every workflow byte outside the existing host report validator', () => {
    expect(validator(workflow).outside).toBe(validator(baseline(workflowPath)).outside);
  });

  it('pins shared query and all script bytes outside Compose capture and serialization', () => {
    const original = baseline(scriptPath);
    expect(script.slice(script.indexOf('query() {'), script.indexOf('valid_sha()')))
      .toBe(original.slice(original.indexOf('query() {'), original.indexOf('valid_sha()')));
    const normalized = script
      .replace('compose_probe_status=not_run compose_pipeline_exit_status=null compose_captured_bytes=null compose_home_present=false\nif [[ ${HOME+x} == x ]]; then compose_home_present=true; fi\n', '')
      .replace('    --arg probe_status "$compose_probe_status" --argjson pipeline_status "$compose_pipeline_exit_status" \\\n    --argjson captured_bytes "$compose_captured_bytes" --argjson home_present "$compose_home_present" \\\n', '')
      .replace('      compose_probe:{status:$probe_status,pipeline_exit_status:$pipeline_status,captured_bytes:$captured_bytes,home_present:$home_present},\n', '')
      .replace(/compose_pipeline_exit_status=0\n[\s\S]*?compose_probe_status=ok\n(?=compose_version="\$value")/,
        original.slice(original.indexOf('value="$(query docker compose version --short)"'), original.indexOf('compose_version="$value"')));
    expect(normalized).toBe(original);
  });

  it('pins the old host tests and protected state/dependency/rule files to baseline blobs', () => {
    for (const path of ['tests/ci/vps-host-preflight.test.ts', 'progress.json', 'features.json', 'harness-rules.md',
      'AGENTS.md', 'CLAUDE.md', 'generator.md', 'package.json', 'package-lock.json', 'vitest.config.ts']) {
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), path)
        .toBe(createHash('sha256').update(baseline(path)).digest('hex'));
    }
  });
});
