import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const source = 'cddb822cc2452c2042309de73064a38f0c4224cf';
const bases = ['a5ea6e3f66ab4b4b831de88a6bcb078f444b2aca', '1f52c86d5e5448ed48959cb1bfe63b6de1d26798'];
const scriptPath = 'scripts/ci/vps-host-preflight.sh';
const workflowPath = '.github/workflows/deploy-vps.yml';
const canary = 'SYNTHETIC_SCOPE_STDOUT_STDERR_CANARY';
const homeCanary = '/synthetic/SCOPE_HOME_PATH_CANARY';
let count = 0;

function blob(ref, path) {
  const result = spawnSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function control(name, fn) {
  const detail = fn();
  count += 1;
  console.log(JSON.stringify({ control: name, result: 'satisfied', detail }));
}

function filterParts(workflow) {
  const open = '          if ! jq -e --arg source "$GITHUB_SHA" \'\n';
  const close = '          \' "$work/inventory.json" >/dev/null 2>&1; then';
  const start = workflow.indexOf(open);
  assert.notEqual(start, -1);
  const filterStart = start + open.length;
  const end = workflow.indexOf(close, filterStart);
  assert.notEqual(end, -1);
  return { filter: workflow.slice(filterStart, end), outside: [workflow.slice(0, filterStart), workflow.slice(end)] };
}

const candidateScript = blob(source, scriptPath);
const candidateWorkflow = blob(source, workflowPath);
const candidateFilter = filterParts(candidateWorkflow);
const initialization = 'compose_probe_status=not_run compose_pipeline_exit_status=null compose_captured_bytes=null compose_home_present=false\nif [[ ${HOME+x} == x ]]; then compose_home_present=true; fi\n';
const serializationArgs = '    --arg probe_status "$compose_probe_status" --argjson pipeline_status "$compose_pipeline_exit_status" \\\n    --argjson captured_bytes "$compose_captured_bytes" --argjson home_present "$compose_home_present" \\\n';
const serializedObject = '      compose_probe:{status:$probe_status,pipeline_exit_status:$pipeline_status,captured_bytes:$captured_bytes,home_present:$home_present},\n';
const oldCompose = 'value="$(query docker compose version --short)" || fail compose_unavailable\n[[ "$value" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+([a-zA-Z0-9.+-]{0,32})?$ ]] || fail compose_unavailable\n';

for (const base of bases) {
  control(`exact script allowed-spans only vs ${base}`, () => {
    for (const addition of [initialization, serializationArgs, serializedObject]) assert.equal(candidateScript.split(addition).length, 2);
    const start = candidateScript.indexOf('compose_pipeline_exit_status=0\n');
    const end = candidateScript.indexOf('compose_version="$value"\n', start);
    assert(start > 0 && end > start);
    const normalized = candidateScript.slice(0, start) + oldCompose + candidateScript.slice(end);
    assert.equal(normalized.replace(initialization, '').replace(serializationArgs, '').replace(serializedObject, ''), blob(base, scriptPath));
    return 'Entire script equals base after removing only explicit initialization/serialization and restoring Compose capture.';
  });
  control(`workflow byte freeze and old validator predicates vs ${base}`, () => {
    const original = filterParts(blob(base, workflowPath));
    assert.deepEqual(candidateFilter.outside, original.outside);
    const metadataStart = candidateFilter.filter.indexOf('            (.compose_probe |');
    const metadataEnd = candidateFilter.filter.indexOf('            (.settings |', metadataStart);
    assert(metadataStart > 0 && metadataEnd > metadataStart);
    const normalized = (candidateFilter.filter.slice(0, metadataStart) + candidateFilter.filter.slice(metadataEnd))
      .replace('            def bounded_integer($max): type == "number" and floor == . and . >= 0 and . <= $max;\n', '')
      .replace('"versions","compose_probe","settings"', '"versions","settings"');
    assert.equal(normalized, original.filter);
    return 'Every byte outside actual jq filter unchanged; every old filter predicate unchanged.';
  });
  control(`old tests and protected paths frozen vs ${base}`, () => {
    const result = spawnSync('git', ['diff', '--name-only', base, source, '--', 'tests/ci/vps-host-preflight.test.ts', 'src', 'app', 'prisma', 'progress.json', 'features.json', '.auto-memory', 'package.json', 'package-lock.json', 'vitest.config.ts', 'harness-rules.md', 'AGENTS.md', 'CLAUDE.md', 'generator.md'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    return 'No protected-path diff.';
  });
}

const root = mkdtempSync('/tmp/hpsc-');
const bin = join(root, 'bin');
const deploy = join(root, 'deploy');
const callsPath = join(root, 'calls.jsonl');
const copiedScript = join(root, 'exact-script.sh');
mkdirSync(bin);
mkdirSync(deploy);
writeFileSync(copiedScript, candidateScript);
writeFileSync(join(deploy, '.env'), `AUTH_SECRET=${canary}\n`);
writeFileSync(join(deploy, 'docker-compose.yml'), `# ${canary}\n`);
const fixtureHash = () => ['.env', 'docker-compose.yml'].map((path) => createHash('sha256').update(readFileSync(join(deploy, path))).digest('hex'));

function tool(name, body) {
  const path = join(bin, name);
  writeFileSync(path, `#!${process.execPath}\nconst fs=require('node:fs'),a=process.argv.slice(2),e=process.env;\nfs.appendFileSync(e.CALLS,JSON.stringify([${JSON.stringify(name)},...a])+'\\n');\n${body}\n`);
  chmodSync(path, 0o755);
}

tool('uname', `console.log(a[0]==='-s'?'Linux':'x86_64');`);
tool('df', `console.log('Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 99999 100 99899 1% /scope');`);
tool('stat', `const s=fs.statSync(a.at(-1));console.log(a[1]==='%s'?s.size:(s.mode&0o7777).toString(8));`);
tool('sha256sum', `console.log(require('node:crypto').createHash('sha256').update(fs.readFileSync(a.at(-1))).digest('hex')+'  fixture');`);
tool('curl', `process.exit(99);`);
tool('docker', `process.stderr.write(e.CANARY);
if(a[0]==='version'){if(e.EARLY)process.exit(4);console.log('29.1.3');return;}
if(JSON.stringify(a)===JSON.stringify(['compose','version','--short'])){
if(e.HANG){setTimeout(()=>process.exit(0),60000);return;}
process.stdout.write(Buffer.from(e.OUTPUT,'base64'),()=>process.exit(Number(e.DOCKER_CODE)));return;}
if(a[0]==='ps')return;
process.exit(99);`);
tool('timeout', `const {spawnSync}=require('node:child_process');
if(a.shift()!=='--signal=KILL'||a.shift()!=='5s')process.exit(99);
const command=a.shift(),r=spawnSync(command,a,{timeout:5000,killSignal:'SIGKILL'});
const code=r.error?.code==='ETIMEDOUT'?124:r.status??1;
if(r.stderr)process.stderr.write(r.stderr);
process.stdout.on('error',()=>process.exit(code));
process.stdout.write(r.stdout||Buffer.alloc(0),()=>process.exit(code));`);
tool('head', `const {spawnSync}=require('node:child_process');
const input=fs.readFileSync(0),r=spawnSync('/usr/bin/head',a,{input});
const code=e.HEAD_CODE!==''&&input.equals(Buffer.from(e.OUTPUT,'base64'))?Number(e.HEAD_CODE):r.status??1;
process.stdout.write(r.stdout,()=>process.exit(code));`);

function run(options = {}) {
  rmSync(callsPath, { force: true });
  const env = { PATH: `${bin}:/usr/bin:/bin`, CALLS: callsPath, CANARY: canary,
    OUTPUT: Buffer.from(options.output ?? 'v2.35.1\n').toString('base64'),
    DOCKER_CODE: String(options.code ?? 0), HEAD_CODE: options.headCode === undefined ? '' : String(options.headCode),
    EARLY: options.early ? '1' : '', HANG: options.hang ? '1' : '', LC_ALL: 'en_US.UTF-8' };
  if (options.home !== undefined) env.HOME = options.home;
  const before = fixtureHash();
  const started = Date.now();
  const result = spawnSync('/bin/bash', [copiedScript, deploy, source], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert(!`${result.stdout}${result.stderr}`.includes(canary));
  assert(!`${result.stdout}${result.stderr}`.includes(homeCanary));
  assert.deepEqual(fixtureHash(), before);
  const body = JSON.parse(result.stdout);
  const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse) : [];
  assert(calls.every(([name, ...argv]) => name !== 'docker' || ['version', 'compose', 'ps'].includes(argv[0])));
  return { body, calls, elapsed_ms: Date.now() - started };
}

function composeRefusal(options, status, pipeline, bytes) {
  const value = run(options);
  assert.equal(value.body.reason, 'compose_unavailable');
  assert.equal(value.body.outcome, 'refused');
  assert.equal(value.body.versions.compose, 'unknown');
  assert.deepEqual(value.body.compose_probe, { status, pipeline_exit_status: pipeline, captured_bytes: bytes, home_present: options.home !== undefined });
  assert.deepEqual(value.body.files, {});
  assert.deepEqual(value.calls.filter(([name]) => name === 'docker'), [
    ['docker', 'version', '--format', '{{.Server.Version}}'], ['docker', 'compose', 'version', '--short']
  ]);
  assert.deepEqual(value.calls.filter(([name]) => name === 'timeout').at(-1), ['timeout', '--signal=KILL', '5s', 'docker', 'compose', 'version', '--short']);
  assert(value.calls.filter(([name]) => name === 'head').every((call) => JSON.stringify(call) === '["head","-c","16385"]'));
  assert(!value.calls.some(([name]) => ['stat', 'sha256sum', 'curl'].includes(name)));
  return { probe: value.body.compose_probe, elapsed_ms: value.elapsed_ms, later_queries: false, disclosure: false };
}

try {
  for (const home of [undefined, '', homeCanary]) {
    control(`HOME presence ${home === undefined ? 'unset' : home === '' ? 'empty' : 'path canary'}`, () => {
      const value = run({ home, output: 'v2.35.1\n\n' });
      assert.deepEqual(value.body.compose_probe, { status: 'ok', pipeline_exit_status: 0, captured_bytes: 7, home_present: home !== undefined });
      assert.equal(value.body.reason, 'missing_or_multiple_app');
      return value.body.compose_probe;
    });
  }
  control('early refusal retains not_run/null metrics', () => {
    const value = run({ early: true, home: '' });
    assert.equal(value.body.reason, 'docker_unavailable');
    assert.deepEqual(value.body.compose_probe, { status: 'not_run', pipeline_exit_status: null, captured_bytes: null, home_present: true });
    assert(!value.calls.some((call) => call.includes('compose')));
    return value.body.compose_probe;
  });
  for (const code of [7, 124, 137, 141, 255]) control(`numeric pipeline ${code} no internal attribution`, () => composeRefusal({ output: `${canary}\n\n`, code }, 'command_failed', code, Buffer.byteLength(canary)));
  control('rightmost failing stage is not Docker status', () => composeRefusal({ output: 'v2.35.1\n', code: 7, headCode: 141 }, 'command_failed', 141, 7));
  control('invalid retained stdout is redacted', () => composeRefusal({ output: `${canary}\n` }, 'invalid_version', 0, Buffer.byteLength(canary)));
  for (const code of [0, 23]) control(`over-cap precedence with pipeline ${code}`, () => composeRefusal({ output: 'x'.repeat(20000), code }, 'output_bound_exceeded', code, 16385));
  control('stripped trailing newlines are not total emitted bytes', () => composeRefusal({ output: `${'x'.repeat(16384)}\n\n` }, 'invalid_version', 0, 16384));
  control('multibyte retained byte cap with truncated code point', () => composeRefusal({ output: '\u00e9'.repeat(10000) }, 'output_bound_exceeded', 0, 16385));
  control('bounded synthetic hang preserves query argv', () => {
    const detail = composeRefusal({ hang: true }, 'command_failed', 124, 0);
    assert(detail.elapsed_ms < 9000);
    return { ...detail, limit: 'Synthetic timeout fixture; not a real host or owned-tree cleanup proof.' };
  });

  const body = run({ early: true }).body;
  const gate = (probe, additions = {}) => spawnSync('jq', ['-e', '--arg', 'source', source, candidateFilter.filter], { input: JSON.stringify({ ...body, ...additions, compose_probe: probe }), encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  const statuses = [
    { status: 'not_run', pipeline_exit_status: null, captured_bytes: null, home_present: false },
    { status: 'ok', pipeline_exit_status: 0, captured_bytes: 7, home_present: true },
    { status: 'invalid_version', pipeline_exit_status: 0, captured_bytes: 0, home_present: false },
    { status: 'command_failed', pipeline_exit_status: 255, captured_bytes: 16384, home_present: false },
    { status: 'output_bound_exceeded', pipeline_exit_status: 141, captured_bytes: 16385, home_present: true }
  ];
  for (const probe of statuses) control(`real validator admits typed ${probe.status} metadata`, () => { assert.equal(gate(probe).status, 0); return probe; });
  const good = statuses[1];
  const negatives = [undefined, null, [], canary, {}, { ...good, raw_output: canary },
    ...Object.keys(good).map((key) => Object.fromEntries(Object.entries(good).filter(([name]) => name !== key))),
    ...['timeout', 'missing_plugin', null, 0, true].map((status) => ({ ...good, status })),
    ...[null, -1, 256, 0.5, '0', false, {}].map((pipeline_exit_status) => ({ ...good, pipeline_exit_status })),
    ...[null, -1, 16385, 0.5, '7', true, []].map((captured_bytes) => ({ ...good, captured_bytes })),
    ...[null, 'true', 0, {}, homeCanary].map((home_present) => ({ ...good, home_present })),
    { ...good, status: 'not_run' }, { ...good, status: 'not_run', pipeline_exit_status: null },
    { ...good, status: 'command_failed' }, { ...good, status: 'invalid_version', pipeline_exit_status: 1 },
    { ...good, status: 'output_bound_exceeded' }, { ...good, status: 'output_bound_exceeded', captured_bytes: 16386 },
    { ...good, status: 'output_bound_exceeded', captured_bytes: 16385, pipeline_exit_status: null }
  ];
  control('real validator rejects all independent malformed metadata controls', () => {
    for (const probe of negatives) assert.notEqual(gate(probe).status, 0, JSON.stringify(probe));
    return { rejected_cases: negatives.length };
  });
  control('real validator rejects secret-bearing report additions', () => {
    for (const addition of [{ secret: canary }, { versions: { ...body.versions, raw: canary } }, { files: { secret: { sha256: canary, mode: '600' } } }]) assert.notEqual(gate(good, addition).status, 0);
    return { rejected_cases: 3 };
  });
  console.log(JSON.stringify({ summary: 'Independent narrow scope controls completed', controls: count, source, functional_acceptance: 'not_performed', release_ready: false }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
