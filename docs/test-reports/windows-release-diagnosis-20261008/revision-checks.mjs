import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

if (!process.version.startsWith('v22.')) throw new Error('Node 22 required for syntax and synthetic logger controls');
const here = fileURLToPath(new URL('.', import.meta.url));
const preload = pathToFileURL(join(here, 'trace-preload.mjs')).href;
const controls = [];
for (const mode of ['baseline', 'stat-failure', 'append-failure', 'unhandled-child-error']) {
  const root = mkdtempSync(join(tmpdir(), 'tw-log-')), home = join(root, 'home'), health = join(root, 'health');
  mkdirSync(home); mkdirSync(health);
  const program = `import fs from 'node:fs'; import {spawn} from 'node:child_process';
    const mode=process.env.TW_LOG_CONTROL;
    if(mode==='append-failure')fs.appendFileSync=()=>{throw Object.assign(new Error('synthetic append fault'),{code:'EIO'})};
    await import(${JSON.stringify(preload)});
    if(mode==='stat-failure')fs.statSync=()=>{throw Object.assign(new Error('synthetic stat fault'),{code:'EIO'})};
    if(mode==='unhandled-child-error'){spawn(process.env.TW_ROOT+'/missing-executable',[]);}
    else{let success=false,code=null;fs.mkdirSync(process.env.TW_ROOT+'/success');success=true;
      try{fs.lstatSync(process.env.TW_ROOT+'/missing')}catch(error){code=error.code}
      console.log(JSON.stringify({success,originalErrorCode:code}));}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    env: { HOME: home, USERPROFILE: home, TMPDIR: root, TW_ROOT: root, TW_TRACE: join(root, 'trace.jsonl'),
      TW_TRACE_HEALTH: health, TW_LOG_CONTROL: mode }, encoding: 'utf8', timeout: 3_000, maxBuffer: 64 * 1024, killSignal: 'SIGKILL'
  });
  const states = readdirSync(health).map((file) => JSON.parse(readFileSync(join(health, file), 'utf8')));
  const value = mode === 'unhandled-child-error' ? null : JSON.parse(result.stdout);
  const passed = !result.error && (mode === 'unhandled-child-error'
    ? result.status !== 0 && /Unhandled 'error' event/.test(result.stderr)
    : result.status === 0 && value.success && value.originalErrorCode === 'ENOENT' &&
      states.length === 1 && states[0].state === (mode === 'baseline' ? 'complete' : 'failed'));
  controls.push({ mode, passed, status: result.status, stdoutSummary: value, states,
    unhandledErrorPreserved: mode === 'unhandled-child-error' ? /Unhandled 'error' event/.test(result.stderr) : null });
  rmSync(root, { recursive: true, force: true });
}
const syntax = ['native-diagnostics.mjs', 'trace-preload.mjs', 'revision-checks.mjs'].map((file) => {
  const result = spawnSync(process.execPath, ['--check', join(here, file)], { encoding: 'utf8', timeout: 3_000 });
  return { file, exitCode: result.status, code: result.error?.code ?? null };
});
const require = createRequire(import.meta.url);
const Ajv = require('/Volumes/ORICO/project/tokenizer/node_modules/ajv');
const diagnosis = JSON.parse(readFileSync(join(here, 'diagnosis.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(join(here, 'diagnosis.schema.json'), 'utf8')));
const schemaValid = validate(diagnosis);
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const evidenceHashesMatch = diagnosis.evidence.every((entry) => hash(join(here, entry.path)) === entry.sha256);
const sourceHashesMatch = Object.entries(diagnosis.source_hashes).every(([path, digest]) => hash(path) === digest);
const output = { node: process.version, platform: process.platform, windowsProductExecuted: false,
  scope: 'syntax-schema-hashes-and-synthetic-logger-semantics-only', controls, syntax,
  schemaValid, schemaErrors: validate.errors, evidenceHashesMatch, sourceHashesMatch,
  instrumentationHashes: Object.fromEntries(['native-diagnostics.mjs', 'trace-preload.mjs'].map((file) => [file, hash(join(here, file))])) };
writeFileSync(join(here, 'revision-local-checks.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
if (!controls.every((control) => control.passed) || syntax.some((check) => check.exitCode !== 0) || !schemaValid || !evidenceHashesMatch || !sourceHashesMatch) process.exitCode = 1;
