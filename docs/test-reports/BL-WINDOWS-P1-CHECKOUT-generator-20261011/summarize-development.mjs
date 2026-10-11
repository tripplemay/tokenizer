import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const report = 'docs/test-reports/BL-WINDOWS-P1-CHECKOUT-generator-20261011';
const raw = `${report}/raw`;
const sha = b => createHash('sha256').update(b).digest('hex');
const names = fs.readdirSync(raw).filter(p => !p.startsWith('23-')).sort();
const statuses = names.filter(p => p.endsWith('.status.json')).map(p => ({ path: `raw/${p}`, ...JSON.parse(fs.readFileSync(`${raw}/${p}`)) }));
assert.equal(statuses.length, 23);
const failed = statuses.filter(s => s.code !== 0);
assert.deepEqual(failed.map(s => s.path), ['raw/01-before-evidence.status.json']);
assert.equal(failed[0].code, 1);
const tests = JSON.parse(fs.readFileSync(`${raw}/11-checks.raw.json`));
assert.equal(tests.success, true);
assert.equal(tests.numTotalTests, 81);
assert.equal(tests.numPassedTests, 81);
assert.equal(tests.numFailedTests, 0);
assert.equal(tests.numPendingTests, 0);
const assertions = tests.testResults.flatMap(t => t.assertionResults);
assert.equal(assertions.length, 81);
assert(assertions.every(a => a.status === 'passed'));
assert.equal(tests.testResults.length, 1);
assert(tests.testResults[0].name.endsWith('/tests/diagnostics/windows-p1-stages.test.ts'));
const groups = [...new Set(assertions.map(a => a.ancestorTitles[0]))];
const bindings = JSON.parse(fs.readFileSync('docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json'));
assert.deepEqual(groups, bindings.required_future_controls);
const install = fs.readFileSync(`${raw}/10-npm-ci.combined.log`, 'utf8');
assert(install.includes('7 high severity vulnerabilities'));
const evidence = JSON.parse(fs.readFileSync(`${raw}/17-post-development-evidence.stdout.log`));
const hashes = names.map(path => { const b = fs.readFileSync(`${raw}/${path}`); return { path: `raw/${path}`, bytes: b.length, sha256: sha(b) }; });
const manifest = { format: 'windows-p1-checkout-generator-raw-manifest-v1', snapshotExcludesOwn23Capture: true, files: hashes };
fs.writeFileSync(`${report}/raw-manifest.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ statuses, testCounts: { total: 81, passed: 81, failed: 0, skipped: 0, files: 1, groups: groups.length },
  originalControlGroups: groups, requiredControlDeclarationUnchanged: true,
  sourceCommit: evidence.sourceCommit, sourceParent: evidence.sourceCommitParent, fileHashes: evidence.fileHashes,
  rawManifestFiles: hashes.length, rawManifestSha256: sha(fs.readFileSync(`${report}/raw-manifest.json`)),
  npmHighSeverityCount: 7, auditFixPerformed: false,
  independentAcceptance: false, nativeExecution: false, releaseReady: false }, null, 2));
