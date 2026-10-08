import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

assert(process.version.startsWith('v22.'), 'use Node22 for this evidence-only parser');

const here = fileURLToPath(new URL('.', import.meta.url));
const original = join(here, 'original');
const download = join(original, 'run-37808814119-original');
const output = join(download, 'windows-release-diagnosis-20261008/native-output-1791476860167');
const cases = ['workflow', 'privacy', 'parent', 'subprocess', 'confirmation', 'binding', 'healthy'];
const read = (path) => {
  const bytes = readFileSync(path);
  assert(bytes.length <= 512 * 1024, 'individual evidence input exceeds bound');
  return bytes;
};
const json = (path) => JSON.parse(read(path).toString('utf8'));
const inventory = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'no evidence symlink permitted');
    if (entry.isDirectory()) walk(path);
    else {
      assert(entry.isFile());
      const bytes = read(path);
      inventory.push({ path: relative(here, path).replaceAll('\\', '/'), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
};
walk(original);
assert.equal(inventory.length, 32);
const provenance = json(join(download, 'windows-native-ci-20261008/provenance.json'));
const result = json(join(download, 'windows-native-ci-20261008/diagnostic-result.json'));
assert.equal(provenance.head, 'f6b89d781a74f7baff4db0d47733e813f04b839c');
assert.equal(provenance.failed_release_sha, '76d916ba2e3a7147acda5ac9ef15fa70a9cd9958');
assert.equal(provenance.runtime.platform, 'win32');
assert.equal(provenance.runtime.node, 'v22.23.3');
assert.equal(provenance.runtime.uv, '1.51.0');
assert.equal(result.head, provenance.head);
assert.equal(result.exit_code, 1);
const parsed = {};
for (const name of cases) {
  const outer = json(join(output, name + '.json'));
  const inner = JSON.parse(outer.stdout);
  const trace = read(join(output, name + '.trace.jsonl')).toString('utf8').trim().split('\n').map((line, index) => ({ line: index + 1, ...JSON.parse(line) }));
  const health = json(join(output, name + '.trace-health.json'));
  const cleanup = json(join(output, name + '.cleanup.json'));
  assert.equal(outer.case, name);
  assert.equal(outer.status, 0);
  assert.equal(outer.stopped, false);
  assert.equal(inner.releaseAcceptance, false);
  assert.deepEqual(cleanup.liveFixturePids, []);
  assert.equal(cleanup.traceTruncated, false);
  const workers = trace.filter((event) => event.event === 'spawn-sync' && event.workerKind);
  parsed[name] = { observations: inner.observations, health, cleanup,
    workers, traceRows: trace.length,
    events: trace.filter((event) => event.event !== 'fs' || event.target !== 'object') };
}
const subprocess = parsed.subprocess;
assert.equal(subprocess.workers.map((event) => event.workerKind).join(','), 'timeout,timeout,ok,supervision,ok,output');
const combinedWorker = subprocess.workers[3].childPid;
const combinedTimeline = subprocess.events.filter((event) => event.pid === combinedWorker);
const inheritedWorker = subprocess.workers[2].childPid;
const inheritedTimeline = subprocess.events.filter((event) => event.pid === inheritedWorker || event.pid === 7292 || event.pid === 880);
const replayPowerShell = {};
for (const name of ['parent', 'confirmation', 'binding', 'healthy']) {
  assert(parsed[name].workers.every((event) => event.workerKind === 'timeout'));
  replayPowerShell[name] = parsed[name].workers.map((worker) => {
    const events = parsed[name].events.filter((event) => event.pid === worker.childPid);
    const launched = events.find((event) => event.event === 'spawn' && event.executable === 'powershell.exe');
    const killed = events.find((event) => event.event === 'spawn' && event.executable === 'taskkill.exe');
    const closed = events.find((event) => event.event === 'child-close' && event.executable === 'powershell.exe');
    assert(launched && killed && closed);
    return { workerLine: worker.line, workerPid: worker.childPid, powerShellPid: launched.childPid,
      spawnLine: launched.line, taskkillLine: killed.line, closeLine: closed.line,
      beforeTaskkillMs: killed.monotonicMs - launched.monotonicMs,
      closeAfterTaskkillMs: closed.monotonicMs - killed.monotonicMs,
      totalWorkerMs: worker.elapsedMs, workerKind: worker.workerKind,
      capturedOutputRows: events.filter((event) => ['stdout-bytes', 'stderr-bytes'].includes(event.event)).length };
  });
}
const failedCompletionConditions = cases.flatMap((name) => parsed[name].health.traceComplete ? [] : [name + ':trace-completeness-unknown']);
assert.deepEqual(failedCompletionConditions, ['subprocess:trace-completeness-unknown']);
const analysis = { schemaVersion: 1, analysisOnly: true, releaseAcceptance: false,
  runId: 37808814119, provenance, result, failedCompletionConditions,
  evidenceInventory: inventory, cases: parsed, replayPowerShell, combinedTimeline, inheritedTimeline };
writeFileSync(join(here, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
writeFileSync(join(here, 'SHA256SUMS'), inventory.map((item) => `${item.sha256}  ${item.path}`).join('\n') + '\n');
assert(statSync(join(here, 'analysis.json')).size < 256 * 1024);
console.log(JSON.stringify({ analysisOnly: true, evidenceFiles: inventory.length,
  analysisBytes: statSync(join(here, 'analysis.json')).size, cases: cases.length,
  failedCompletionConditions, releaseAcceptance: false }));
