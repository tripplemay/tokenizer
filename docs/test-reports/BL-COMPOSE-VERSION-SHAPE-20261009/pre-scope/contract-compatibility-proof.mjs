import { spawnSync } from 'node:child_process';

const source = '3405031799ec1da5ab1759be325e2041638a3dd8';
const specPath = 'docs/specs/BL-COMPOSE-VERSION-SHAPE-20261009.md';
const testPath = 'tests/ci/vps-host-preflight-observability.test.ts';
function blob(path) {
  const result = spawnSync('git', ['show', `${source}:${path}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
const spec = blob(specPath);
const test = blob(testPath);
const start = test.indexOf("  it('validates each fixed classification using the actual workflow filter'");
const end = test.indexOf('\n  it(', start + 1);
if (start < 0 || end < 0) throw new Error('Original metadata fixture block not found');
const block = test.slice(start, end);
if (!block.includes('const body = run().body;') ||
    !block.includes('gate({ ...body, compose_probe: probe })') ||
    !block.includes('.toBe(0)') ||
    !test.includes("options.output ?? 'v2.35.1\\n'")) {
  throw new Error('Original fixture or positive expectation changed');
}
if (!spec.includes('It is null before successful bounded capture, on nonzero pipeline or\noutput overflow.') ||
    !spec.includes('Preserve its existing functional assertions,\n   test count, fixtures')) {
  throw new Error('Reviewed spec constraints changed; retain this result and review the new spec separately');
}
const statuses = [...block.matchAll(/\{ status: '([a-z_]+)'/g)].map((match) => match[1]);
const conflicts = statuses.filter((status) => ['not_run', 'command_failed', 'output_bound_exceeded'].includes(status));
const proof = {
  role: 'independent scope critic, not functional Evaluator',
  exact_spec_sha: source,
  verdict: conflicts.length ? 'BLOCKED' : 'NO_COUNTEREXAMPLE',
  method: 'static contract satisfiability check; no candidate validator or host script executed',
  original_fixture_statuses: statuses,
  default_retained_value_is_bounded_success: true,
  default_report_shape_required_to_be_nonnull: true,
  original_spread_retains_default_shape: true,
  original_positive_expectation: 'validator exit 0',
  required_null_shape_statuses_in_frozen_positive_fixture: conflicts,
  contradiction: 'The frozen positive fixture retains a nonnull shape where the new required relation mandates null.'
};
console.log(JSON.stringify(proof, null, 2));
process.exitCode = conflicts.length ? 1 : 0;
