import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const origin = '007fd07941bad043025003ed0433ca079801e31d';
const target = '5c5c283b08d225b42d8db19abcbe5d3c1f562ac4';
const originalPath = 'docs/test-reports/BL-COMPOSE-VERSION-SHAPE-20261009/post-scope-65b10cb/scope-controls.mjs';
const read = spawnSync('git', ['show', `${origin}:${originalPath}`], { encoding: 'utf8', timeout: 5000 });
if (read.status !== 0) throw new Error('Cannot read immutable original critic controls');
let program = read.stdout;
function exactReplace(before, after) {
  if (program.split(before).length !== 2) throw new Error('Control adaptation premise changed');
  program = program.replace(before, after);
}
exactReplace("const source = '65b10cbe3985d933e88eed6c29e7421748af36fd';", `const source = '${target}';`);
exactReplace(
  "check('old-diagnostic-only-extra-offscope-is-added-zero-byte-negative', () => removeOnce(normalizedNew, extraNegative) === normalizedOld);",
  "check('old-diagnostic-no-extra-negative-and-exact-frozen-residual', () => !normalizedNew.includes(extraNegative) && normalizedNew === normalizedOld);"
);
const run = spawnSync(process.execPath, ['--input-type=module', '-'], {
  input: program, encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin', NODE_ENV: 'test' }
});
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
process.stderr.write(JSON.stringify({
  immutable_critic_program_ref: `${origin}:${originalPath}`,
  immutable_critic_program_sha256: createHash('sha256').update(read.stdout).digest('hex'),
  adaptation: 'In memory only: exact candidate SHA and repaired negative-region expectation. Original 52-control program/output are not edited.'
}) + '\n');
process.exitCode = run.status ?? 1;
