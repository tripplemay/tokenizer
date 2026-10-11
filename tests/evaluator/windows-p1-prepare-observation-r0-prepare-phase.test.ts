// Fresh independent OFFLINE supporting evaluation, batch
// BL-WINDOWS-P1-PREPARE-OBSERVATION-SUPPORT / F004, task ...-kimi-r0.
// Additive and report-only: no source/spec/original bytes are touched.
// Static byte controls pin the candidate against immutable baseline 61cf64e;
// behavioral controls slice the ACTUAL pinned source (state block, prepare()
// body, terminal try/catch) into a fully stubbed test-local VM with no real
// fs/child/OS/worker/kill/native effects. No replacement logger is
// reimplemented: every observed byte is produced by the real sliced code.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();
const REL = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const BASELINE = '61cf64e67a6fda231bb090e77c19d5ececb908af';
const PINNED_SHA256 = 'c245a528fb8549915396b5f052bf3841f35b03d88d6b7b5e91982b6f0f07dc4f';
const BASELINE_SHA256 = '6548ea1cbf7584873f61b4cb396bc9d4ce8567c672d23313b56a38e8ce0d3bae';
const GENERIC = 'windows-p1-initial diagnostic evidence unavailable\n';
const GENERIC_SRC = 'windows-p1-initial diagnostic evidence unavailable\\n';
const PHASES = ['P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12'];
const line = (p: string) => `TW_P1_PREPARE_FAILURE_V1:${p}\n`;
const src = readFileSync(`${repo}/${REL}`, 'utf8');
const base = execFileSync('git', ['show', `${BASELINE}:${REL}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 22 });
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const stripWs = (s: string) => s.replace(/\s+/g, '');

function sliceBrace(text: string, braceIdx: number): string {
  let depth = 0;
  for (let i = braceIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(braceIdx, i + 1); }
  }
  throw new Error('unbalanced brace slice');
}
const stateRe = /let prepareFailurePhase = null;\nconst prepareFailureLines = \{[\s\S]*?\n\};/;
const prepareRe = /function prepare\(\) \{[\s\S]*?\n\}/;
const DISPATCH_BRANCH = "if (same(args, ['--prepare'])) { prepareFailurePhase = 'P00'; prepare(); }";
const CATCH_ADD = 'if (prepareFailurePhase !== null) process.stderr.write(Object.hasOwn(prepareFailureLines, prepareFailurePhase) ?\n' +
  '      prepareFailureLines[prepareFailurePhase] : prepareFailureLines.P00);';
function slicesOf(text: string) {
  const state = text.match(stateRe);
  const prep = text.match(prepareRe);
  const branch = text.indexOf(DISPATCH_BRANCH);
  const tryKw = text.lastIndexOf('try {', branch);
  const tryBlock = sliceBrace(text, text.indexOf('{', tryKw));
  const afterTry = text.slice(text.indexOf('{', tryKw) + tryBlock.length);
  const catchKw = afterTry.indexOf('catch');
  const catchBlock = sliceBrace(afterTry, afterTry.indexOf('{', catchKw));
  return { state: state?.[0] ?? '', prep: prep?.[0] ?? '', tryCatch: `try ${tryBlock} catch ${catchBlock}`, catchBlock, branch };
}

const ALLOWED_PHASE_LINES: RegExp[] = [
  /^let prepareFailurePhase = null;$/,
  /^const prepareFailureLines = \{$/,
  /^P\d\d: 'TW_P1_PREPARE_FAILURE_V1:P\d\d\\n',?$/,
  /^prepareFailurePhase = 'P\d\d';$/,
  /^prepareFailurePhase = null;$/,
  /^if \(same\(args, \['--prepare'\]\)\) \{ prepareFailurePhase = 'P00'; prepare\(\); \}$/,
  /^if \(prepareFailurePhase !== null\) process\.stderr\.write\(Object\.hasOwn\(prepareFailureLines, prepareFailurePhase\) \?$/,
  /^prepareFailureLines\[prepareFailurePhase\] : prepareFailureLines\.P00\);$/,
];
const OPS: [string, (l: string) => boolean][] = [
  ['P01', l => l === 'assertWindowsRunner();'],
  ['P02', l => l === 'validateBindings();'],
  ['P03', l => l === 'const executionSha = checkoutSha();'],
  ['P04', l => l === 'assert.equal(executionSha, process.env.GITHUB_SHA);'],
  ['P05', l => l === 'const system = systemEnvironment(process.env);'],
  ['P06', l => l.startsWith('assert(/^[a-z]:[') && l.includes("'local-drive SystemRoot required'")],
  ['P07', l => l === 'safeDirectory(dirname(scratch));'],
  ['P08', l => l === 'original.mkdirSync(scratch);'],
  ['P09', l => l.startsWith('const provenance = {')],
  ['P10', l => l === 'const prepareSourceFiles = sourceFiles();'],
  ['P11', l => l === 'assert(validateProvenance(provenance, prepareSourceFiles, executionSha));'],
  ['P12', l => l === "writeJson(join(scratch, 'provenance.json'), 'provenance', provenance);"],
];

function violations(text: string): string[] {
  const v: string[] = [];
  if (/\r/.test(text)) v.push('CR byte present');
  const s = slicesOf(text);
  if (!s.state) v.push('state block missing');
  if (!s.prep) v.push('prepare missing');
  // thirteen fixed 29-byte literals, exact enum order, LF only
  const mapBody = (s.state.match(/const prepareFailureLines = \{([\s\S]*)\};/) ?? [])[1] ?? '';
  const entries = [...mapBody.matchAll(/(P\d\d): '([^']*)',?/g)].map(m => ({ id: m[1], lit: m[2] }));
  if (entries.length !== 13) v.push(`map entries=${entries.length}`);
  entries.forEach((e, i) => {
    if (e.id !== PHASES[i]) v.push(`map order[${i}]=${e.id}`);
    if (e.lit !== `TW_P1_PREPARE_FAILURE_V1:${e.id}\\n`) v.push(`literal shape ${e.id}`);
    if (Buffer.byteLength(e.lit.replace(/\\n$/, '\n'), 'utf8') !== 29) v.push(`literal bytes ${e.id}`);
  });
  // generic message: exactly one source occurrence, 51 bytes decoded
  if (text.split(GENERIC_SRC).length - 1 !== 1) v.push('generic occurrence count');
  if (Buffer.byteLength(GENERIC, 'utf8') !== 51) v.push('generic decoded bytes');
  // prepare body: assignment immediately before each operation, order P01..P12, success reset last
  if (s.prep) {
    const body = s.prep.split('\n').slice(1, -1).map(l => l.trim()).filter(l => l.length > 0);
    let cursor = 0;
    for (const [p, match] of OPS) {
      const ai = body.indexOf(`prepareFailurePhase = '${p}';`, cursor);
      if (ai !== cursor) { v.push(`${p} assignment position`); break; }
      const oi = ai + 1;
      if (oi >= body.length || !match(body[oi])) { v.push(`${p} operation not immediately after`); break; }
      cursor = oi + 1;
      if (p === 'P09') while (cursor < body.length && !body[cursor - 1].endsWith('};')) cursor++;
    }
    if (cursor === body.length - 1 && body[cursor] === 'prepareFailurePhase = null;') { /* ok */ }
    else v.push('success reset missing or trailing statements');
    const inBody = (s.prep.match(/prepareFailurePhase = /g) ?? []).length;
    if (inBody !== 13) v.push(`prepare assignment count=${inBody}`);
    if ((s.prep.match(/sourceFiles\(\)/g) ?? []).length !== 2) v.push('sourceFiles pass count != 2');
  }
  // dispatch: P00 only inside the exact prepare branch
  if (text.split("prepareFailurePhase = 'P00';").length - 1 !== 1) v.push('P00 assignment count');
  if (!text.includes(DISPATCH_BRANCH)) v.push('dispatch branch shape');
  // terminal catch: original generic + exactly one fixed lookup line, no binding, exit 1
  if (!/\} catch \{/.test(text.slice(s.branch))) v.push('catch binding present');
  if (text.split(CATCH_ADD).length - 1 !== 1) v.push('catch addition count');
  if ((s.catchBlock.match(/process\.exitCode = 1/g) ?? []).length !== 1) v.push('exitCode count');
  if ((s.catchBlock.match(/process\.stderr\.write\(/g) ?? []).length !== 2) v.push('catch stderr write count');
  const foreign = s.catchBlock.split('\n')
    .filter(l => !l.includes("process.stdout.write(JSON.stringify({ format: 'windows-p1-initial-probe-v1'") && !l.includes('scriptSha256: c.scriptSha256'))
    .join('\n');
  for (const bad of ['.message', '.stack', '.name', '.code', 'process.env', 'canary', 'JSON.stringify', 'String(', 'Error'])
    if (foreign.includes(bad)) v.push(`forbidden token in catch: ${bad}`);
  // every prepareFailure occurrence allowlisted (no dynamic/raw/error/env/path/stack content)
  text.split('\n').forEach((l, i) => {
    const t = l.trim();
    if (t.includes('prepareFailure') && !ALLOWED_PHASE_LINES.some(r => r.test(t))) v.push(`disallowed line ${i + 1}`);
  });
  // baseline recovery after removing permitted slots
  let r = text
    .replace(/let prepareFailurePhase = null;\nconst prepareFailureLines = \{\n(?:  P\d\d: 'TW_P1_PREPARE_FAILURE_V1:P\d\d\\n',\n){12}  P12: 'TW_P1_PREPARE_FAILURE_V1:P12\\n'\n\};\n/, '')
    .split('\n').filter(l => !/^\s*prepareFailurePhase = ('P\d\d'|null);$/.test(l)).join('\n')
    .replace(DISPATCH_BRANCH, "if (same(args, ['--prepare'])) prepare();")
    .replace(`${CATCH_ADD}\n`, '')
    .replace('const prepareSourceFiles = sourceFiles();\n', '')
    .replace('validateProvenance(provenance, prepareSourceFiles, executionSha)', 'validateProvenance(provenance, sourceFiles(), executionSha)');
  if (/prepareFailure/.test(r)) v.push('leftover refs after strip');
  if (stripWs(r) !== stripWs(base)) v.push('baseline recovery mismatch');
  const hex = (x: string) => (x.match(/[a-f0-9]{64}/g) ?? []).sort();
  if (JSON.stringify(hex(text)) !== JSON.stringify(hex(base))) v.push('identity literals changed');
  if ((text.match(/process\.stdout\.write\(/g) ?? []).length !== (base.match(/process\.stdout\.write\(/g) ?? []).length)
    v.push('stdout writes changed');
  return v;
}

// ---- actual-source-slice VM harness (fully stubbed; no real fs/child/OS/worker/kill/native) ----
const SHA40 = 'a'.repeat(40);
const CANARY = 'RAW-STDERR-CANARY|PRIVATE|secret-token|C:\\private\\canary-path';
interface Fail { op?: string; wrongSha?: boolean; badRoot?: boolean; retFalse?: boolean; sf2Only?: boolean }
function buildContext(args: string[], fail: Fail = {}) {
  const calls: string[] = [];
  const stderr: string[] = [];
  const stdout: string[] = [];
  const mkErr = () => {
    const e = new Error(`synthetic ${CANARY}`);
    Object.defineProperty(e, 'message', { configurable: true, get() { throw new Error('message-getter-read'); } });
    Object.defineProperty(e, 'stack', { configurable: true, get() { throw new Error(`stack-getter-read ${CANARY}`); } });
    Object.defineProperty(e, 'name', { configurable: true, get() { throw new Error('name-getter-read'); } });
    (e as any).code = CANARY;
    return e;
  };
  const gate = (name: string) => { calls.push(name); if (fail.op === name) throw mkErr(); };
  let sfCount = 0;
  const processFake: any = {
    env: { GITHUB_SHA: SHA40, GITHUB_REF: 'refs/heads/x', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', ImageOS: 'w', ImageVersion: '1' },
    platform: 'win32', arch: 'x64', version: 'v22.22.0', versions: { uv: '1.0.0' },
    stderr: { write: (s: string) => { stderr.push(String(s)); return true; } },
    stdout: { write: (s: string) => { stdout.push(String(s)); return true; } },
    exitCode: 0,
  };
  const sandbox: Record<string, any> = {
    assert, same: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b), process: processFake,
    BINDINGS: { planning_base: 'base', environment: { synthetic_keys: [] } },
    release: () => '10.0.0', sorted: (a: string[]) => [...a].sort(),
    join: (a: string, b: string) => `${a}\\${b}`, dirname: (p: string) => p, scratch: 'C:\\scratch',
    original: { mkdirSync: () => gate('mkdirSync') }, safeDirectory: () => gate('safeDirectory'),
    assertWindowsRunner: () => gate('assertWindowsRunner'), validateBindings: () => gate('validateBindings'),
    checkoutSha: () => { gate('checkoutSha'); return fail.wrongSha ? 'b'.repeat(40) : SHA40; },
    systemEnvironment: () => { gate('systemEnvironment'); return { SystemRoot: fail.badRoot ? '\\\\net\\share' : 'C:\\Windows' }; },
    sourceFiles: () => {
      sfCount++; calls.push('sourceFiles');
      if (fail.op === 'sourceFiles' && (fail.sf2Only ? sfCount === 2 : sfCount === 1)) throw mkErr();
      return [{ path: 'x', sha256: '0'.repeat(64) }];
    },
    validateProvenance: () => { gate('validateProvenance'); if (fail.op === 'validateProvenance') throw mkErr(); return !fail.retFalse; },
    writeJson: () => gate('writeJson'),
    runParent: async () => { gate('runParent'); }, seal: () => gate('seal'), verifyUpload: () => gate('verifyUpload'),
    runProbe: async () => { gate('runProbe'); throw mkErr(); }, assertWindowsRunnerForProbe: () => gate('assertWindowsRunnerForProbe'),
    CASES: [{ variant: 'T1', caseId: 'case-T1', scriptSha256: '0'.repeat(64) }],
    caseFor: (v: string) => sandbox.CASES.find((c: any) => c.variant === v),
    unknownNative: () => ({ outcome: 'unknown', metadataSource: 'unknown', status: null, signal: null }),
    installGuard: () => gate('installGuard'),
  };
  const context = vm.createContext(sandbox);
  const s = slicesOf(src);
  const script = `${s.state}\n${s.prep}\nconst args = ${JSON.stringify(args)};\n` +
    `globalThis.__phase = () => prepareFailurePhase;\nglobalThis.__run = async () => {\n${s.tryCatch}\n};\n`;
  vm.runInContext(script, context, { filename: 'pinned-actual-source-slices.mjs' });
  return { context: context as any, calls, stderr, stdout, processFake };
}
const run = async (args: string[], fail: Fail = {}, inject?: string) => {
  const h = buildContext(args, fail);
  if (inject !== undefined) vm.runInContext(`prepareFailurePhase = ${JSON.stringify(inject)};`, h.context);
  await h.context.__run();
  return h;
};
const EXPECTED_ORDER = ['assertWindowsRunner', 'validateBindings', 'checkoutSha', 'systemEnvironment', 'safeDirectory',
  'mkdirSync', 'sourceFiles', 'sourceFiles', 'validateProvenance', 'writeJson'];
const FAILURE_CASES: [string, Fail, string[]][] = [
  ['P01', { op: 'assertWindowsRunner' }, ['assertWindowsRunner']],
  ['P02', { op: 'validateBindings' }, ['assertWindowsRunner', 'validateBindings']],
  ['P03', { op: 'checkoutSha' }, ['assertWindowsRunner', 'validateBindings', 'checkoutSha']],
  ['P04', { wrongSha: true }, ['assertWindowsRunner', 'validateBindings', 'checkoutSha']],
  ['P05', { op: 'systemEnvironment' }, ['assertWindowsRunner', 'validateBindings', 'checkoutSha', 'systemEnvironment']],
  ['P06', { badRoot: true }, ['assertWindowsRunner', 'validateBindings', 'checkoutSha', 'systemEnvironment']],
  ['P07', { op: 'safeDirectory' }, ['assertWindowsRunner', 'validateBindings', 'checkoutSha', 'systemEnvironment', 'safeDirectory']],
  ['P08', { op: 'mkdirSync' }, ['assertWindowsRunner', 'validateBindings', 'checkoutSha', 'systemEnvironment', 'safeDirectory', 'mkdirSync']],
  ['P09', { op: 'sourceFiles' }, ['assertWindowsRunner', 'validateBindings', 'checkoutSha', 'systemEnvironment', 'safeDirectory', 'mkdirSync', 'sourceFiles']],
  ['P10', { op: 'sourceFiles', sf2Only: true }, EXPECTED_ORDER.slice(0, 8)],
  ['P11', { retFalse: true }, EXPECTED_ORDER.slice(0, 9)],
  ['P12', { op: 'writeJson' }, EXPECTED_ORDER],
];

describe('static-byte-controls-vs-baseline61', () => {
  it('pins candidate and baseline sha256 identities', () => {
    expect(sha(src)).toBe(PINNED_SHA256);
    expect(sha(base)).toBe(BASELINE_SHA256);
  });
  it('accepts the pinned candidate with zero violations across all static controls', () => {
    expect(violations(src)).toEqual([]);
  });
  it('fixes byte math: 13x29-byte lines, 51-byte generic, 80-byte terminal maximum', () => {
    PHASES.forEach(p => expect(Buffer.byteLength(line(p))).toBe(29));
    expect(Buffer.byteLength(GENERIC)).toBe(51);
    expect(51 + 29).toBe(80);
  });
});

describe('actual-source-slice-VM-prepare-failure-phases', () => {
  for (const [phase, fail, order] of FAILURE_CASES) {
    it(`${phase}: forced synthetic throw emits generic+exact fixed line, max 80 bytes, exit 1, no leak`, async () => {
      const h = await run(['--prepare'], fail);
      const err = h.stderr.join('');
      expect(err).toBe(GENERIC + line(phase));
      expect(Buffer.byteLength(err)).toBe(80);
      expect((err.match(/TW_P1_PREPARE_FAILURE_V1:/g) ?? []).length).toBe(1);
      expect(h.stdout).toEqual([]);
      expect(h.processFake.exitCode).toBe(1);
      expect(h.context.__phase()).toBe(phase);
      expect(h.calls).toEqual(order);
      for (const bad of ['RAW-STDERR-CANARY', 'PRIVATE', 'secret-token', 'canary-path', 'synthetic', 'getter-read'])
        expect(err.includes(bad)).toBe(false);
    });
  }
  it('P10 proves both source read passes retained: second pass fails after first succeeded', async () => {
    const h = await run(['--prepare'], { op: 'sourceFiles', sf2Only: true });
    expect(h.calls.filter(c => c === 'sourceFiles').length).toBe(2);
    expect(h.stderr.join('')).toBe(GENERIC + line('P10'));
  });
});

describe('actual-source-slice-VM-success-and-other-modes', () => {
  it('success: full call order, zero added bytes, phase reset to null, exit code untouched', async () => {
    const h = await run(['--prepare']);
    expect(h.calls).toEqual(EXPECTED_ORDER);
    expect(h.stderr).toEqual([]);
    expect(h.stdout).toEqual([]);
    expect(h.processFake.exitCode).toBe(0);
    expect(h.context.__phase()).toBe(null);
  });
  it('non-prepare modes (--run/--seal/unknown): original generic only, no observation line', async () => {
    for (const [args, fail] of [[['--run'], { op: 'runParent' }], [['--seal'], { op: 'seal' }], [[], {}]] as [string[], Fail][]) {
      const h = await run(args, fail);
      expect(h.stderr.join('')).toBe(GENERIC);
      expect(h.processFake.exitCode).toBe(1);
      expect(h.stdout).toEqual([]);
    }
  });
  it('probe failure mode: original stdout JSON only, no stderr observation', async () => {
    const h = await run(['--probe', 'T1']);
    expect(h.stderr).toEqual([]);
    expect(h.stdout.length).toBe(1);
    expect(JSON.parse(h.stdout[0]).probeSetupComplete).toBe(false);
    expect(h.processFake.exitCode).toBe(1);
  });
  it('import/guard path: dispatch never entered, state stays inactive, zero output', () => {
    const h = buildContext(['--prepare']);
    expect(h.context.__phase()).toBe(null);
    expect(h.stderr).toEqual([]);
    expect(h.stdout).toEqual([]);
  });
});

describe('actual-source-slice-VM-unknown-and-invalid-state', () => {
  it.each([['P99'], [''], ['p00'], ['P1'], ['P00 ']])('invalid/unassigned state %j maps only to fixed P00 (unknown)', async bad => {
    const h = await run(['--run'], { op: 'runParent' }, bad);
    expect(h.stderr.join('')).toBe(GENERIC + line('P00'));
    expect(Buffer.byteLength(h.stderr.join(''))).toBe(80);
  });
  it('valid P00 state emits the P00 line exactly once', async () => {
    const h = await run(['--run'], { op: 'runParent' }, 'P00');
    expect(h.stderr.join('')).toBe(GENERIC + line('P00'));
  });
});

describe('negative-mutant-controls-must-be-rejected', () => {
  const mutants: [string, (t: string) => string][] = [
    ['reordered phases', t => t.replace("prepareFailurePhase = 'P04';", 'prepareFailurePhase = \'P05\';').replace("prepareFailurePhase = 'P05';\n  const system", "prepareFailurePhase = 'P04';\n  const system")],
    ['phase after operation', t => t.replace("prepareFailurePhase = 'P05';\n  const system = systemEnvironment(process.env);", "const system = systemEnvironment(process.env);\n  prepareFailurePhase = 'P05';")],
    ['28-byte literal', t => t.replace("P07: 'TW_P1_PREPARE_FAILURE_V1:P07\\n'", "P07: 'TW_P1_PREPARE_FAILURE_V1:P7\\n'")],
    ['CRLF literal', t => t.replace("P08: 'TW_P1_PREPARE_FAILURE_V1:P08\\n'", "P08: 'TW_P1_PREPARE_FAILURE_V1:P08\\r\\n'")],
    ['real CR byte', t => t.replace("prepareFailurePhase = 'P01';\n", "prepareFailurePhase = 'P01';\r\n")],
    ['duplicate catch line', t => t.replace(CATCH_ADD, `${CATCH_ADD}\n    ${CATCH_ADD}`)],
    ['extra P13 phase', t => t.replace("P12: 'TW_P1_PREPARE_FAILURE_V1:P12\\n'", "P12: 'TW_P1_PREPARE_FAILURE_V1:P12\\n',\n  P13: 'TW_P1_PREPARE_FAILURE_V1:P13\\n'")],
    ['dynamic catch content', t => t.replace('prepareFailureLines[prepareFailurePhase] : prepareFailureLines.P00);', "prepareFailureLines[prepareFailurePhase] : String(new Error('x').stack));")],
    ['missing success reset', t => t.replace('  writeJson(join(scratch, \'provenance.json\'), \'provenance\', provenance);\n  prepareFailurePhase = null;\n}', "  writeJson(join(scratch, 'provenance.json'), 'provenance', provenance);\n}")],
    ['P00 outside prepare branch', t => t.replace("else if (same(args, ['--run'])) await runParent();", "else if (same(args, ['--run'])) { prepareFailurePhase = 'P00'; await runParent(); }")],
    ['removed second source pass', t => t.replace("  prepareFailurePhase = 'P10';\n  const prepareSourceFiles = sourceFiles();\n  prepareFailurePhase = 'P11';\n  assert(validateProvenance(provenance, prepareSourceFiles, executionSha));", "  prepareFailurePhase = 'P10';\n  prepareFailurePhase = 'P11';\n  assert(validateProvenance(provenance, sourceFiles(), executionSha));")],
    ['changed identity literal', t => t.replace(/[a-f0-9]{64}/, '0'.repeat(64))],
    ['altered generic message', t => t.replace(GENERIC_SRC, 'windows-p1-initial diagnostic evidence missing\\n')],
    ['widened stdout output', t => t.replace(CATCH_ADD, `${CATCH_ADD}\n    process.stdout.write('ok\\n');`)],
  ];
  for (const [name, mutate] of mutants) {
    it(`rejects: ${name}`, () => {
      const mutated = mutate(src);
      expect(mutated).not.toBe(src);
      expect(violations(mutated).length).toBeGreaterThan(0);
    });
  }
});
