import fs from 'node:fs';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const report = dirname(fileURLToPath(import.meta.url));
const repo = resolve(report, '../../..');
const source = '221f2f87d94db1656e3000662796d79621b696f5';
const predecessor = '888a5acd7a8a441c9ec4ad898453f149cf8d6b7c';
const receipts = '/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008/docs/test-reports/BL-RELEASE-READINESS-coordination-20261011';
const owned = '/Volumes/ORICO/project/.wp1cb-plan-20261011';
const fixture = join(owned, 'git-fixture-1');
const w = '.github/workflows/windows-p1-stages-diagnostic.yml';
const j = 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json';
const m = 'docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md';
const s = 'docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs';
const t = 'tests/diagnostics/windows-p1-stages.test.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = bytes => ({ bytes: bytes.length, sha256: hash(bytes) });
const rawLog = [];
for (const path of [owned, join(owned, 'home'), join(owned, 'tmp'), join(owned, 'xdg')]) fs.mkdirSync(path, { recursive: true });
const env = {
  PATH: process.env.PATH, HOME: join(owned, 'home'), USERPROFILE: join(owned, 'home'),
  TMP: join(owned, 'tmp'), TEMP: join(owned, 'tmp'), TMPDIR: join(owned, 'tmp'),
  XDG_CONFIG_HOME: join(owned, 'xdg'), GIT_CONFIG_GLOBAL: join(owned, 'globalGit'),
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'
};
function git(args, { cwd = repo, input, autocrlf } = {}) {
  const commandEnv = { ...env };
  if (autocrlf !== undefined) Object.assign(commandEnv, {
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.longpaths', GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'core.autocrlf', GIT_CONFIG_VALUE_1: autocrlf
  });
  const result = cp.spawnSync('git', ['-c', 'core.fileMode=false', ...args], {
    cwd, env: commandEnv, input, maxBuffer: 16 * 1024 * 1024, timeout: 10000
  });
  rawLog.push({ args: ['-c', 'core.fileMode=false', ...args], cwd,
    autocrlf: autocrlf ?? null, status: result.status, signal: result.signal,
    stdout: metadata(result.stdout ?? Buffer.alloc(0)), stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8'),
    errorCode: result.error?.code ?? null });
  assert(!result.error && result.status === 0 && result.signal === null, 'owned read/fixture git command failed');
  return result.stdout;
}
const blob = (sha, path) => git(['show', `${sha}:${path}`]);
const texts = Object.fromEntries([w, j, m, s].map(path => [path, blob(source, path).toString('utf8')]));
const binding = JSON.parse(texts[j]);
assert.equal(binding.revision, 2);
assert.deepEqual(binding.workflow.checkout_env, {
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.longpaths', GIT_CONFIG_VALUE_0: 'true'
});
const prefix = 'windows-checkout-native-run38153928452-';
const manifestName = prefix + 'transport-manifest.json';
const manifestBytes = fs.readFileSync(join(receipts, manifestName));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.run_id, 38153928452);
assert.equal(manifest.source, source);
const receiptHashes = [];
const receiptData = {};
for (const suffix of ['final-original.json', 'jobs-original.json', 'artifacts-original.json', 'full-original.log']) {
  const path = prefix + suffix, bytes = fs.readFileSync(join(receipts, path));
  const entry = manifest.entries.find(entry => entry.path === path);
  assert(entry && entry.bytes === bytes.length && entry.sha256 === hash(bytes), 'immutable receipt mismatch');
  receiptHashes.push({ path, ...metadata(bytes), matchesTransportManifest: true });
  receiptData[suffix] = suffix.endsWith('.json') ? JSON.parse(bytes) : bytes.toString('utf8');
}
receiptHashes.push({ path: manifestName, ...metadata(manifestBytes), matchesTransportManifest: null });
const run = receiptData['final-original.json'];
const job = receiptData['jobs-original.json'].jobs[0];
assert.equal(run.head_sha, source);
assert.equal(job.head_sha, source);
assert.equal(run.run_attempt, 1);
assert.equal(run.conclusion, 'failure');
assert.equal(job.id, 114512876414);
const log = receiptData['full-original.log'];
const actual = log.match(/actual: '([a-f0-9]{64})'/)[1];
const expected = log.match(/expected: '([a-f0-9]{64})'/)[1];
const jsonBytes = Buffer.from(texts[j]);
assert.equal(hash(jsonBytes), expected);
assert(!texts[j].includes('\r') && !jsonBytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])));
const transforms = [
  ['unchanged-control', jsonBytes],
  ['LF-to-CRLF-only', Buffer.from(texts[j].replace(/\n/g, '\r\n'))],
  ['prepend-UTF8-BOM-only', Buffer.concat([Buffer.from([239, 187, 191]), jsonBytes])],
  ['remove-final-LF-only', jsonBytes.subarray(0, jsonBytes.length - 1)]
].map(([name, bytes]) => ({ name, ...metadata(bytes), matchesCiActual: hash(bytes) === actual }));
assert(transforms[1].matchesCiActual && transforms.filter(row => row.matchesCiActual).length === 1);
const inputs = [...binding.prior_inputs, ...binding.frozen_runtime_sources];
const frozenInputs = inputs.map(input => {
  const bytes = blob(source, input.path);
  assert.equal(hash(bytes), input.sha256);
  assert(bytes.equals(blob(predecessor, input.path)));
  assert(bytes.equals(fs.readFileSync(join(repo, input.path))));
  return { ...input, bytes: bytes.length, sourceAndPredecessorAndWorkingBytesEqual: true };
});
const sourcePaths = [...new Set([w, j, m, s, t, '.gitattributes', ...inputs.map(input => input.path)])];
const sourceBlobs = new Map(sourcePaths.map(path => [path, blob(source, path)]));
const sourceHashes = [w, j, m, s, t, '.gitattributes'].map(path => {
  assert(sourceBlobs.get(path).equals(fs.readFileSync(join(repo, path))));
  return { path, source: metadata(sourceBlobs.get(path)), predecessor: metadata(blob(predecessor, path)),
    workingBytesEqualSource: true };
});
const tracked = git(['ls-tree', '-rz', '--full-tree', source]);
const trackedPaths = tracked.toString('utf8').split('\0').filter(Boolean).map(row => row.split('\t')[1]);
const attributePaths = trackedPaths.filter(path => path === '.gitattributes' || path.endsWith('/.gitattributes'));
assert.deepEqual(attributePaths, ['.gitattributes']);

// Only this disposable fixture is written; source blobs and receipts remain untouched.
assert(!fs.existsSync(fixture), 'fresh fixture path required; never reuse a prior run');
fs.mkdirSync(fixture);
git(['init', '--quiet'], { cwd: fixture, autocrlf: 'false' });
for (const [path, bytes] of sourceBlobs) {
  const object = git(['hash-object', '-w', '--stdin'], { cwd: fixture, input: bytes, autocrlf: 'false' }).toString('utf8').trim();
  git(['update-index', '--add', '--cacheinfo', `100644,${object},${path}`], { cwd: fixture, autocrlf: 'false' });
}
const fixtureChecks = [];
for (const autocrlf of ['true', 'false']) {
  git(['checkout-index', '--force', '--all'], { cwd: fixture, autocrlf });
  const files = sourcePaths.map(path => {
    const bytes = fs.readFileSync(join(fixture, path));
    return { path, ...metadata(bytes), matchesSourceRawBytes: bytes.equals(sourceBlobs.get(path)),
      matchesCiActual: path === j ? hash(bytes) === actual : null };
  });
  fixtureChecks.push({ autocrlf, files });
  if (autocrlf === 'true') assert(files.find(row => row.path === j).matchesCiActual);
  else assert(files.every(row => row.matchesSourceRawBytes));
  for (const path of sourcePaths) fs.unlinkSync(join(fixture, path));
}

const stamp = '2026-10-11T16:11:16Z';
const scope = 'C002 checkout-step-only raw-byte identity by core.autocrlf=false; C001 longpaths retained; explicit four-path projection and two CLI identity hashes only; all native contracts unchanged; fresh scope and Coordinator ruling required';
const checkoutBefore = "          GIT_CONFIG_COUNT: '1'\n          GIT_CONFIG_KEY_0: core.longpaths\n          GIT_CONFIG_VALUE_0: 'true'\n";
const checkoutAfter = "          GIT_CONFIG_COUNT: '2'\n          GIT_CONFIG_KEY_0: core.longpaths\n          GIT_CONFIG_VALUE_0: 'true'\n          GIT_CONFIG_KEY_1: core.autocrlf\n          GIT_CONFIG_VALUE_1: 'false'\n";
const jsonEdits = [
  { before: '  "revision": 2,\n', after: '  "revision": 3,\n' },
  { before: `  "updated_at_utc": "${binding.updated_at_utc}",\n`, after: `  "updated_at_utc": "${stamp}",\n` },
  { before: `  "revision_scope": "${binding.revision_scope}",\n`, after: `  "revision_scope": "${scope}",\n` },
  { before: '    "checkout_env":{"GIT_CONFIG_COUNT":"1","GIT_CONFIG_KEY_0":"core.longpaths","GIT_CONFIG_VALUE_0":"true"},\n',
    after: '    "checkout_env":{"GIT_CONFIG_COUNT":"2","GIT_CONFIG_KEY_0":"core.longpaths","GIT_CONFIG_VALUE_0":"true","GIT_CONFIG_KEY_1":"core.autocrlf","GIT_CONFIG_VALUE_1":"false"},\n' }
];
const mdAppend = '\n## 8. C002 checkout raw-byte identity successor scope (proposed 2026-10-11 UTC)\n\nRevision 3 is a proposal only. It grants no implementation, publication, native execution, native environment repair or release authority. C001 at source221 is the already frozen count1/three-key long-path fix; count2/five-key is a new C002 contract, not compliance with the old C001 map.\n\nSolely for the same four existing paths in section 7, C002 supersedes its exact three-key map and revision-1-to-2 wording: (1) change only the checkout action step env to GIT_CONFIG_COUNT=2, retain GIT_CONFIG_KEY_0=core.longpaths and GIT_CONFIG_VALUE_0=true, and add only GIT_CONFIG_KEY_1=core.autocrlf and GIT_CONFIG_VALUE_1=false; (2) append this section to this Markdown without changing any prior byte; (3) change adjacent JSON revision 2 to 3, updated_at_utc to 2026-10-11T16:11:16Z, revision_scope to the exact C002 proposal string and workflow.checkout_env to that exact five-key map, preserving all other bytes; (4) change only the two bindingHash/mdHash 64-character literals in p1-stages.mjs to SHA-256 of the revised JSON/Markdown raw bytes, preserving every other CLI byte. No new implementation file is admitted.\n\nThe five configuration env keys belong only to the checkout action step and its Git subprocess command scope. They are forbidden at workflow/job scope, in GITHUB_ENV, in later steps and in diagnostic owned children. No added command, retry, version query, config write, relocation, sparse checkout, omitted archive, Actions/Node version change or permission/Secrets change is allowed. This prevents checkout text conversion; it never normalizes a hash input or accepts a second identity. The existing raw-byte hash assertions, guards, B001, E0/native env allowlist, API/worker, selections, caps, bounds, commands, tests, required_future_controls, sourceFiles eleven-path set, uploads and original artifacts remain unchanged.\n\nThe CI actual JSON digest is exactly reproduced by the single LF-to-CRLF Buffer transform and by an owned local Git fixture with core.autocrlf=true; this is not observation of the Windows file bytes or its autocrlf setting. A local fixture with core.autocrlf=false preserves all sixteen inspected source blobs, but is not native acceptance. Windows checkout byte preservation and every later INITIAL/native/release gate remain unverified.\n\nA fresh independent supporting pre-scope review must accept this new exact projection before Generator work. Then require a fresh actual-diff/post-scope review, independent different-model-family Kimi supporting gate, and a separate Coordinator ruling before a single new-source non-main CI opportunity. Static positive/negative controls must reject wrong count/value/key, extra key, missing confinement, stale/one-sided hashes, any extra CLI byte and any other source/test/contract delta; the unchanged synthetic suite does not itself freeze this checkout env map. No source221 retry or automatic follow-up run is authorized by this proposal. Compose HARD_STOP/no third Compose, postponed key work, no backup/restore/baseline/password/deploy, release_ready=false and all other release boundaries remain in force.\n';
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, 'single exact replacement');
  return text.replace(before, after);
}
const candidate = { ...texts };
candidate[w] = replaceOnce(candidate[w], checkoutBefore, checkoutAfter);
for (const edit of jsonEdits) candidate[j] = replaceOnce(candidate[j], edit.before, edit.after);
candidate[m] += mdAppend;
const literals = ['bindingHash', 'mdHash'].map((constant, index) => {
  const path = [j, m][index];
  const before = texts[s].match(new RegExp(`^const ${constant} = '([a-f0-9]{64})';$`, 'm'))[1];
  const after = hash(candidate[path]);
  candidate[s] = replaceOnce(candidate[s], `const ${constant} = '${before}';`, `const ${constant} = '${after}';`);
  return { constant, before, after, derivesFrom: path };
});
const mask = text => text.replace(/^(const (?:bindingHash|mdHash) = ')[a-f0-9]{64}(';)/gm, '$1<IDENTITY>$2');
assert.equal(mask(candidate[s]), mask(texts[s]));
assert(candidate[m].startsWith(texts[m]));
const revised = JSON.parse(candidate[j]);
const keysChanged = Object.keys(binding).filter(key => JSON.stringify(binding[key]) !== JSON.stringify(revised[key]));
assert.deepEqual(keysChanged, ['revision', 'updated_at_utc', 'revision_scope', 'workflow']);
const workflowKeysChanged = Object.keys(binding.workflow).filter(key => JSON.stringify(binding.workflow[key]) !== JSON.stringify(revised.workflow[key]));
assert.deepEqual(workflowKeysChanged, ['checkout_env']);
assert.equal(Object.keys(revised.workflow.checkout_env).length, 5);
const result = {
  format: 'windows-p1-binding-identity-planner-probe-v1', source, predecessor,
  sourceTree: git(['rev-parse', `${source}^{tree}`]).toString('utf8').trim(),
  predecessorTree: git(['rev-parse', `${predecessor}^{tree}`]).toString('utf8').trim(),
  receipts: receiptHashes,
  liveTrace: { runId: run.id, runAttempt: run.run_attempt, source: run.head_sha, conclusion: run.conclusion,
    jobId: job.id, branch: job.head_branch, steps: job.steps.map(({ number, name, conclusion }) => ({ number, name, conclusion })),
    artifactCount: receiptData['artifacts-original.json'].total_count, actual, expected,
    diagnosticEntriesReached: false, WindowsBindingBytesCaptured: false, WindowsAutocrlfObserved: false },
  sourceHashes, frozenInputs, attributePaths, attributes: sourceBlobs.get('.gitattributes').toString('utf8'),
  bindingLineEndings: { lf: (texts[j].match(/\n/g) ?? []).length, cr: 0, utf8Bom: false },
  transforms, fixture: { root: fixture, environmentBoundary: env, checks: fixtureChecks,
    nativeWindowsAcceptance: false, disposableOwnedFixtureOnly: true },
  projection: { id: 'C002', proposedBindingRevision: 3, sourceBase: source,
    changes: [
      { path: w, replacements: [{ before: checkoutBefore, after: checkoutAfter }] },
      { path: j, replacements: jsonEdits },
      { path: m, append: mdAppend },
      { path: s, identityLiteralReplacementsOnly: literals }
    ], candidateHashes: [w, j, m, s].map(path => ({ path, ...metadata(Buffer.from(candidate[path])) })),
    candidateCliAfterMaskByteEqual: true, priorMarkdownBytesPreserved: true,
    changedBindingKeys: keysChanged, changedWorkflowBindingKeys: workflowKeysChanged,
    implementationFilesWritten: false },
  rawGitCommands: rawLog
};
fs.writeFileSync(join(report, 'probes.raw.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ capture: 'probes.raw.json', ...metadata(fs.readFileSync(join(report, 'probes.raw.json'))),
  actual, expected, transformMatch: transforms[1],
  fixtureTrueMatchesCiActual: fixtureChecks[0].files.find(row => row.path === j).matchesCiActual,
  fixtureFalseAllSourceBytesEqual: fixtureChecks[1].files.every(row => row.matchesSourceRawBytes),
  candidateHashes: result.projection.candidateHashes }));
