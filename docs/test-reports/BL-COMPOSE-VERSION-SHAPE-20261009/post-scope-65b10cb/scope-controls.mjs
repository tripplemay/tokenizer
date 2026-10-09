import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const base = '917b60c99af1f733103e307b41925d858b696bb4';
const spec = '686d3c6b7e9b7c43ba2d999c56d3435668d06352';
const source = '65b10cbe3985d933e88eed6c29e7421748af36fd';
const paths = {
  script: 'scripts/ci/vps-host-preflight.sh', workflow: '.github/workflows/deploy-vps.yml',
  old: 'tests/ci/vps-host-preflight-observability.test.ts', fresh: 'tests/ci/vps-compose-version-shape.test.ts'
};
const results = [];
function command(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}
const blob = (ref, path) => command(['show', `${ref}:${path}`]);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function check(id, predicate) {
  let passed = false;
  try { passed = Boolean(predicate()); } catch { passed = false; }
  results.push({ id, passed });
}
const oldScript = blob(base, paths.script), script = blob(source, paths.script);
const oldWorkflow = blob(base, paths.workflow), workflow = blob(source, paths.workflow);
const oldTest = blob(base, paths.old), test = blob(source, paths.old), fresh = blob(source, paths.fresh);
const classifierStart = script.indexOf('classify_compose_version() {\n');
const classifierEnd = script.indexOf('\n}\n\nemit() {', classifierStart);
if (classifierStart < 0 || classifierEnd < 0) throw new Error('Classifier boundaries absent');
const classifier = script.slice(classifierStart, classifierEnd + 2);
const addedBlock = `compose_version_shape=null\n\n${classifier}\n`;
function removeOnce(value, fragment) {
  if (value.split(fragment).length !== 2) throw new Error('Expected unique exact fragment');
  return value.replace(fragment, '');
}
function frozenScript(value) {
  value = removeOnce(value, addedBlock);
  value = removeOnce(value, '    --argjson compose_shape "$compose_version_shape" \\\n');
  value = removeOnce(value, '      compose_version_shape:$compose_shape,\n');
  return removeOnce(value, 'compose_version_shape="$(classify_compose_version "$value")"\n');
}
function validator(value) {
  const marker = '          if ! jq -e --arg source "$GITHUB_SHA" \'\n';
  const start = value.indexOf(marker) + marker.length;
  const end = value.indexOf('          \' "$work/inventory.json" >/dev/null 2>&1; then', start);
  if (start < marker.length || end < start) throw new Error('Validator boundaries absent');
  return { filter: value.slice(start, end), outside: value.slice(0, start) + '<FILTER>' + value.slice(end) };
}
const filter = validator(workflow).filter;
const shapeClauseStart = filter.indexOf('            (.compose_probe as $probe | .compose_version_shape as $shape |\n');
const shapeClauseEnd = filter.indexOf('            (.settings |', shapeClauseStart);
const shapeClause = filter.slice(shapeClauseStart, shapeClauseEnd);
check('source.changed-exact-four-nondoc-paths', () => {
  const changed = command(['diff', '--name-only', spec, source]).trim().split('\n').filter((path) => !path.startsWith('docs/'));
  return JSON.stringify(changed.sort()) === JSON.stringify(Object.values(paths).sort());
});
check('source.all-old-test-blobs-outside-allowlisted-file-frozen', () => {
  const changed = command(['diff', '--name-only', base, source, '--', 'tests']).trim().split('\n');
  return JSON.stringify(changed.sort()) === JSON.stringify([paths.old, paths.fresh].sort());
});
check('source.script-all-outside-exact-additions-frozen', () => frozenScript(script) === oldScript);
check('source.workflow-outside-validator-frozen', () => validator(workflow).outside === validator(oldWorkflow).outside);
check('source.workflow-all-old-validator-predicates-frozen', () =>
  removeOnce(removeOnce(filter, shapeClause), ',"compose_version_shape"') === validator(oldWorkflow).filter);
check('source.classifier-pure-shell-local-locale-fixed-format', () =>
  classifier.includes('  local LC_ALL=C retained="$1" candidate="$1"') &&
  !/\$\(|`|\b(query|timeout|docker|curl|jq|awk|sed|grep|source|eval|exec|export|read|cat|env)\b/.test(classifier) &&
  classifier.split('\n').filter((line) => line.trimStart().startsWith('printf ')).length === 1 &&
  classifier.includes('    "$prefix" "$core_present" "$tail_bytes" "$tail_charset" "$has_cr" "$has_lf" "$has_horizontal_space" "$has_escape" "$has_non_ascii"'));
for (const [id, candidate] of [
  ['mutant.new-query-rejected', script.replace('compose_version_shape="$(classify_compose_version "$value")"', 'query docker info\ncompose_version_shape="$(classify_compose_version "$value")"')],
  ['mutant.capture-bound-drift-rejected', script.replace('5s docker compose', '6s docker compose')],
  ['mutant.acceptance-regex-drift-rejected', script.replace('([a-zA-Z0-9.+-]{0,32})?$', '([a-zA-Z0-9.+_-]{0,32})?$')],
  ['mutant.ambient-locale-drift-rejected', script.replace('compose_version_shape=null\n', 'LC_ALL=C\ncompose_version_shape=null\n')]
]) check(id, () => frozenScript(candidate) !== oldScript);
check('mutant.workflow-transport-bound-drift-rejected', () => validator(workflow.replace('150s ssh', '151s ssh')).outside !== validator(oldWorkflow).outside);
const fixtureStart = oldTest.indexOf("  it('validates each fixed classification");
const fixtureEnd = oldTest.indexOf("  it('rejects missing, extra", fixtureStart);
const newFixtureStart = test.indexOf("  it('validates each fixed classification");
const newFixtureEnd = test.indexOf("  it('rejects missing, extra", newFixtureStart);
const oldFixture = oldTest.slice(fixtureStart, fixtureEnd), newFixture = test.slice(newFixtureStart, newFixtureEnd);
check('old-five-fixture-values-and-positive-expectation-retained', () => {
  const oldValues = oldFixture.match(/\{ status: '[^\n]+? \}/g);
  const newValues = newFixture.match(/\{ status: '[^\n]+? \}/g);
  if (!oldValues || !newValues || oldValues.length !== 5 || newValues.length !== 5) return false;
  oldValues[1] = oldValues[1].replace('captured_bytes: 0', 'captured_bytes: Buffer.byteLength(body.versions.compose)');
  return JSON.stringify(oldValues) === JSON.stringify(newValues) &&
    oldFixture.endsWith('.toBe(0);\n  });\n\n') && newFixture.endsWith('.toBe(0);\n  });\n\n');
});
let normalizedOld = oldTest.replace('    // The baseline lacks compose_probe, so its report is not passed to the new validator.\n', '')
  .replace('    const { compose_probe: _probe, timestamp: _timestamp, ...body } = candidate.body;\n', '<STRIP>\n')
  .replace(oldFixture, '<FIVE-FIXTURES>\n');
let normalizedNew = test.replace('    // The baseline lacks both diagnostic fields, so it bypasses the new validator.\n', '')
  .replace('    const { compose_probe: _probe, compose_version_shape: _shape, timestamp: _timestamp, ...body } = candidate.body;\n', '<STRIP>\n')
  .replace(newFixture, '<FIVE-FIXTURES>\n');
const sourcePinStart = normalizedNew.indexOf('      .replace(/compose_version_shape=null');
const sourcePinEnd = normalizedNew.indexOf("      .replace('compose_probe_status=", sourcePinStart);
normalizedNew = removeOnce(normalizedNew, normalizedNew.slice(sourcePinStart, sourcePinEnd));
normalizedNew = removeOnce(normalizedNew, '      .replace(\'    --argjson compose_shape "$compose_version_shape" \\\\\\n\', \'\')\n');
normalizedNew = removeOnce(normalizedNew, '      .replace(\'      compose_version_shape:$compose_shape,\\n\', \'\')\n');
const extraNegative = ",\n      { ...good, status: 'ok', captured_bytes: 0 }";
check('old-diagnostic-exact-authorized-regions-only', () => normalizedNew === normalizedOld);
check('old-diagnostic-only-extra-offscope-is-added-zero-byte-negative', () => removeOnce(normalizedNew, extraNegative) === normalizedOld);
check('old-negative-expectation-and-count-not-weakened', () =>
  test.includes('for (const compose_probe of bad) expect(gate({ ...body, compose_probe }).status, JSON.stringify(compose_probe)).not.toBe(0);') &&
  test.match(/\bit(?:\.each)?\(/g).length === oldTest.match(/\bit(?:\.each)?\(/g).length);
check('new-file-already-rejects-former-zero-byte-case', () => fresh.includes('{ ...body, compose_probe: { ...probe, captured_bytes: 0 } }'));
function classify(value, locale = 'C') {
  const result = spawnSync('/bin/bash', ['-s', '--', value], {
    input: `${classifier}\nbefore="$LC_ALL"\nclassify_compose_version "$1"\nprintf '\\n%s' "$LC_ALL"\n[[ "$before" == "$LC_ALL" ]]\n`,
    encoding: 'utf8', timeout: 2000, env: { PATH: '/usr/bin:/bin', LC_ALL: locale }
  });
  if (result.status !== 0) throw new Error('Isolated classifier refused');
  const separator = result.stdout.lastIndexOf('\n');
  if (result.stdout.slice(separator + 1) !== locale) throw new Error('Locale escaped local scope');
  return { shape: JSON.parse(result.stdout.slice(0, separator)), output: result.stdout };
}
const canary = 'SCOPE_SECRET_CODE_PATH_CANARY_20261009';
check('primitive.synthetic-canary-no-arbitrary-value-emission', () => {
  const value = classify(`2.35.1~_${canary}/synthetic/path\x1b\t`);
  return !value.output.includes(canary) && !value.output.includes('/synthetic/path') &&
    Object.keys(value.shape).sort().join(',') === ['prefix','core_present','tail_bytes','tail_charset','has_cr','has_lf','has_horizontal_space','has_escape','has_non_ascii'].sort().join(',');
});
check('primitive.multibyte-bytes-and-local-locale', () => {
  const value = classify('2.35.1\u00e9', 'en_US.UTF-8').shape;
  return value.tail_bytes === 2 && value.has_non_ascii === true && value.tail_charset === 'other';
});
const originalInventoryPath = 'docs/test-reports/BL-HOST-PREFLIGHT-OBSERVABILITY-20261009/host-preflight-37844242857-artifacts-original/tokenizer-host-preflight-9966db19906fbe4b9b7aaeb53ba80e827b383aca/inventory.json';
const originalInventory = blob(base, originalInventoryPath);
const template = JSON.parse(originalInventory);
template.source_sha = 'c'.repeat(40);
template.compose_probe = { status: 'invalid_version', pipeline_exit_status: 0, captured_bytes: 10, home_present: false };
template.compose_version_shape = classify('2.35.1~deb').shape;
const copy = (value) => JSON.parse(JSON.stringify(value));
function gate(body) {
  return spawnSync('jq', ['-e', '--arg', 'source', template.source_sha, filter], {
    input: JSON.stringify(body), encoding: 'utf8', timeout: 2000,
    env: { PATH: '/usr/bin:/bin' }
  }).status === 0;
}
check('validator.synthetic-fixed-object-accepted', () => gate(template));
for (const status of ['not_run','command_failed','output_bound_exceeded']) {
  const good = copy(template);
  good.compose_probe = { status, pipeline_exit_status: status === 'not_run' ? null : 23,
    captured_bytes: status === 'not_run' ? null : status === 'command_failed' ? 10 : 16385, home_present: false };
  good.compose_version_shape = null;
  check(`validator.${status}-null-accepted`, () => gate(good));
  const bad = copy(good); bad.compose_version_shape = template.compose_version_shape;
  check(`validator.${status}-nonnull-rejected`, () => !gate(bad));
}
const ok = copy(template);
ok.versions.compose = 'v2.35.1'; ok.compose_probe.status = 'ok'; ok.compose_probe.captured_bytes = 7;
ok.compose_version_shape = classify('v2.35.1').shape;
check('validator.synthetic-ok-consistent-shape-accepted', () => gate(ok));
const mutations = [
  ['missing-shape', (body) => { delete body.compose_version_shape; }],
  ['invalid-version-null', (body) => { body.compose_version_shape = null; }],
  ['extra-secret-shape-key', (body) => { body.compose_version_shape.secret = canary; }],
  ['wrong-prefix-type', (body) => { body.compose_version_shape.prefix = 1; }],
  ['wrong-prefix-enum', (body) => { body.compose_version_shape.prefix = canary; }],
  ['core-under-other-prefix', (body) => { body.compose_version_shape.prefix = 'other'; }],
  ['absent-core-with-tail', (body) => { body.compose_version_shape.core_present = false; }],
  ['tail-over-captured', (body) => { body.compose_version_shape.tail_bytes = 11; }],
  ['tail-fraction', (body) => { body.compose_version_shape.tail_bytes = 0.5; }],
  ['tail-zero-nonempty-class', (body) => { body.compose_version_shape.tail_bytes = 0; }],
  ['tail-positive-empty-class', (body) => { body.compose_version_shape.tail_charset = 'empty'; }],
  ['parsed-core-not-parsed-class', (body) => { body.compose_version_shape.tail_charset = 'not_parsed'; }],
  ['empty-prefix-positive-bytes', (body) => { body.compose_version_shape.prefix = 'empty'; body.compose_version_shape.core_present = false; body.compose_version_shape.tail_bytes = null; body.compose_version_shape.tail_charset = 'not_parsed'; }],
  ['extra-legacy-root-key', (body) => { body.secret = canary; }],
  ['extra-old-probe-key', (body) => { body.compose_probe.secret = canary; }]
];
for (const [id, mutate] of mutations) {
  const body = copy(template); mutate(body);
  check(`validator.${id}-rejected`, () => !gate(body));
}
for (const key of ['has_cr','has_lf','has_horizontal_space','has_escape','has_non_ascii']) {
  const wrong = copy(template); wrong.compose_version_shape[key] = 'false';
  check(`validator.${key}-wrong-type-rejected`, () => !gate(wrong));
  const flag = copy(ok); flag.compose_version_shape[key] = true;
  check(`validator.ok-${key}-true-rejected`, () => !gate(flag));
}
const zero = copy(ok); zero.compose_probe.captured_bytes = 0;
check('validator.old-impossible-ok-zero-byte-rejected', () => !gate(zero));
const report = {
  schema_version: 1, role: 'scope critic controls, not functional acceptance', exact_base: base, exact_spec_sha: spec,
  exact_source_sha: source, results, total: results.length, passed: results.filter((result) => result.passed).length,
  failures: results.filter((result) => !result.passed),
  original_inventory_sha256: sha256(originalInventory),
  source_sha256: Object.fromEntries(Object.entries(paths).map(([name, path]) => [path, sha256(blob(source, path))])),
  execution: 'In-memory source mutations and isolated pure classifier/jq filter only; no full host script, Docker, SSH, GH, credentials or old functional suites.'
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.failures.length ? 1 : 0;
