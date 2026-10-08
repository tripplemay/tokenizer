import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync,
  renameSync, linkSync, symlinkSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const cases = ['workflow', 'privacy', 'parent', 'subprocess', 'confirmation', 'binding', 'healthy'];
const canary = 'TW_RAW_CONTENT_CANARY';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32' || !process.version.startsWith('v22.')) {
  throw new Error('This unexecuted diagnostic requires native Windows and Node 22; no macOS substitute');
}

if (process.argv[2] !== '--probe') {
  const selected = process.argv[2] ? [process.argv[2]] : cases;
  if (selected.some((name) => !cases.includes(name))) throw new Error('unknown diagnostic case');
  const output = join(here, 'native-output-' + Date.now());
  mkdirSync(output);
  let failed = false;
  for (const name of selected) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tw-')));
    const home = join(root, 'home'), temp = join(root, 'tmp'), trace = join(root, 'trace.jsonl');
    const traceHealthDirectory = join(root, 'trace-health');
    mkdirSync(home); mkdirSync(temp); mkdirSync(traceHealthDirectory);
    const env = {};
    for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PATHEXT']) {
      const match = Object.keys(process.env).find((value) => value.toLowerCase() === key.toLowerCase());
      if (match) env[key] = process.env[match];
    }
    Object.assign(env, { HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp,
      TW_ROOT: root, TW_TRACE: trace, TW_TRACE_HEALTH: traceHealthDirectory, TW_CASE: name, TW_REPO: repo,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0',
      NODE_OPTIONS: '--import=' + pathToFileURL(join(here, 'trace-preload.mjs')).href });
    writeFileSync(env.GIT_CONFIG_GLOBAL, '');
    let diagnosticPid;
    const result = await new Promise((resolveResult) => {
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--probe'], { cwd: repo, env, windowsHide: true });
      diagnosticPid = child.pid;
      let bytes = 0, stdout = '', stderr = '', stopped = false;
      const stop = () => {
        if (stopped || child.exitCode !== null || child.signalCode !== null) return;
        stopped = true;
        // Only the still-live directly spawned diagnostic root; never an image-name target.
        spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { timeout: 2_000, stdio: 'ignore', windowsHide: true });
        child.kill('SIGKILL');
      };
      const timer = setTimeout(stop, 40_000);
      for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
        stream.on('data', (chunk) => { bytes += chunk.length; if (bytes > 64 * 1024) { stop(); return; }
          if (key === 'stdout') stdout += chunk; else stderr += chunk; });
      }
      child.on('error', (error) => { clearTimeout(timer); resolveResult({ launchCode: error.code, stopped: true }); });
      child.on('close', (status, signal) => { clearTimeout(timer); resolveResult({ status, signal, stopped, stdout, stderr }); });
    });
    const disclosure = /TW_RAW_CONTENT_CANARY|PRIVATE|reader|RAW-STDERR-CANARY/.test(JSON.stringify(result));
    const safe = disclosure ? { disclosure: true, rawBytesRetained: false } : result;
    writeFileSync(join(output, name + '.json'), JSON.stringify({ case: name, node: process.version,
      uv: process.versions.uv, platform: process.platform, instrumented: true, ...safe }, null, 2) + '\n');
    let traceBytes = Buffer.alloc(0), traceReadFailureCode = null;
    try { if (existsSync(trace)) traceBytes = readFileSync(trace); }
    catch (error) { traceReadFailureCode = error.code ?? 'TRACE_READ_FAILED'; }
    if (traceBytes.length) writeFileSync(join(output, name + '.trace.jsonl'), traceBytes);
    // Original child fixture independently exits within 15 s. No stale PID is signalled.
    await new Promise((done) => setTimeout(done, name === 'subprocess' || result.stopped ? 16_000 : 100));
    const pidFile = join(root, 'pids');
    const pids = existsSync(pidFile) ? [...new Set(readFileSync(pidFile, 'utf8').trim().split('\n').map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0))] : [];
    const alive = pids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    const expectedTracePids = new Set([diagnosticPid].filter((pid) => Number.isSafeInteger(pid) && pid > 0));
    let invalidTrace = false;
    for (const line of traceBytes.toString('utf8').trim().split('\n').filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (event.event === 'preload') expectedTracePids.add(event.pid);
        if (['spawn', 'spawn-sync'].includes(event.event) && /^node(?:\.exe)?$/i.test(event.executable ?? '') && Number.isSafeInteger(event.childPid) && event.childPid > 0) expectedTracePids.add(event.childPid);
      } catch { invalidTrace = true; }
    }
    const states = new Map();
    let healthFiles = [], healthReadFailureCode = null;
    try { healthFiles = readdirSync(traceHealthDirectory).filter((file) => /^\d+\.json$/.test(file)); }
    catch (error) { healthReadFailureCode = error.code ?? 'HEALTH_DIRECTORY_READ_FAILED'; }
    for (const file of healthFiles) {
      const pid = Number(file.slice(0, -5));
      try {
        const state = JSON.parse(readFileSync(join(traceHealthDirectory, file), 'utf8'));
        if (state.pid !== pid || !['pending', 'failed', 'complete'].includes(state.state) ||
          Object.keys(state).some((key) => !['pid', 'state', 'reasonCode'].includes(key)) ||
          (state.reasonCode !== undefined && (typeof state.reasonCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(state.reasonCode)))) throw new Error();
        states.set(pid, state);
      } catch { states.set(pid, { pid, state: 'invalid' }); }
    }
    const missingPids = [...expectedTracePids].filter((pid) => !states.has(pid));
    const traceComplete = traceBytes.length > 0 && !traceReadFailureCode && !healthReadFailureCode && !invalidTrace && missingPids.length === 0 &&
      [...states.values()].every((state) => state.state === 'complete');
    writeFileSync(join(output, name + '.trace-health.json'), JSON.stringify({ expectedTracePids: [...expectedTracePids],
      states: [...states.values()], missingPids, invalidTrace, traceReadFailureCode, healthReadFailureCode,
      traceComplete, traceCompletenessUnknown: !traceComplete,
      productCleanupConclusion: 'not-derived-from-trace-health' }) + '\n');
    writeFileSync(join(output, name + '.cleanup.json'), JSON.stringify({ fixturePids: pids, liveFixturePids: alive,
      ownedLifetimeCapMs: 15_000, stalePidsSignalled: false, rootRetained: alive.length > 0,
      traceBytes: traceBytes.length, traceTruncated: traceBytes.length >= 512 * 1024 }) + '\n');
    failed ||= disclosure || result.stopped || result.status !== 0 || alive.length > 0 || traceBytes.length >= 512 * 1024 || !traceComplete;
    if (alive.length === 0) rmSync(root, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ outputDirectory: output, diagnosticCompleted: !failed, releaseAcceptance: false }));
  process.exitCode = failed ? 1 : 0;
} else {
  const root = process.env.TW_ROOT, name = process.env.TW_CASE;
  if (!root || process.env.HOME !== join(root, 'home') || process.env.USERPROFILE !== process.env.HOME) throw new Error('synthetic HOME required');
  const observations = [];
  const measure = (stage, action) => {
    const start = performance.now();
    try { const value = action(); observations.push({ stage, elapsedMs: performance.now() - start, ok: true, value }); return value; }
    catch (error) { observations.push({ stage, elapsedMs: performance.now() - start, ok: false,
      errorClass: error.constructor.name, code: error.code ?? null,
      refusal: error.message?.startsWith('Replay refused:') ? error.message : null,
      supervisionMessage: error.constructor.name.startsWith('BoundedSubprocess') ? error.message : null }); return null; }
  };
  const product = (path) => import(pathToFileURL(join(repo, path)).href);
  const file = join(root, 'source.jsonl');
  const row = (id = 'one', cwd = root) => JSON.stringify({ type: 'assistant', uuid: id, cwd,
    timestamp: '2026-10-07T12:00:00.000Z', message: { role: 'assistant', id, model: 'fixture-model',
      content: canary, usage: { input_tokens: 1, output_tokens: 2 } } }) + '\n';
  const cfg = { serverUrl: 'http://127.0.0.1:9', projectRoots: [], sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: 'local-only', includePaths: [], excludePaths: [] } };
  if (name === 'workflow') {
    const workflow = readFileSync(join(repo, '.github/workflows/deploy-vps.yml'), 'utf8');
    for (const [form, text] of [['checkout', workflow], ['LF', workflow.replace(/\r\n/g, '\n')], ['CRLF', workflow.replace(/\r?\n/g, '\r\n')]]) {
      observations.push({ stage: form, crlfCount: (text.match(/\r\n/g) ?? []).length, jobs:
        ['verify', 'verify-windows', 'verify-macos-agent', 'verify-db', 'verify-browser', 'release-artifact'].map((job) => {
          const index = text.indexOf(`  ${job}:\n`), block = text.slice(index).split(/\n  [a-z][a-z-]+:\n/)[0];
          return { job, index, extractedLength: block.length, guardPresent: block.includes("if: github.event_name != 'workflow_dispatch' || inputs.operation == 'release'") };
        }) });
    }
  } else if (name === 'privacy') {
    const { filterUsageEvents } = await product('src/cli/privacy.ts');
    const allowed = join(root, 'allowed'), regular = join(root, 'regular'), cycle = join(root, 'cycle'), broken = join(root, 'broken');
    mkdirSync(allowed); writeFileSync(regular, 'not-directory'); symlinkSync(cycle, cycle, 'junction'); symlinkSync(join(root, 'absent'), broken, 'junction');
    const event = (workspacePath) => ({ source: 'claude-code', sourceEventId: 'stable', occurredAt: '2026-10-07T12:00:00.000Z', workspacePath });
    for (const [label, path, expected] of [['regular-child', join(regular, 'child'), 0], ['cycle', cycle, 0], ['broken-child', join(broken, 'child'), 0], ['missing-directory-child', join(allowed, 'missing', 'child'), 1]]) {
      measure(label + '-event', () => { const input = event(path), filtered = filterUsageEvents([input], { ...cfg.privacy, includePaths: [root] });
        return { count: filtered.length, expected, identityUntouched: filtered.length === 0 || filtered[0] === input }; });
      if (expected === 0) measure(label + '-rule', () => ({ count: filterUsageEvents([event(root)], { ...cfg.privacy, includePaths: [path] }).length, expected: 0 }));
    }
  } else if (name === 'parent') {
    const { readBoundedReplayFile } = await product('src/cli/replay.ts');
    for (const stage of ['afterPathStat', 'afterRead']) {
      const parent = join(root, stage), moved = join(root, stage + '-moved'); mkdirSync(parent); const source = join(parent, 'source.jsonl'); writeFileSync(source, row());
      let hookReached = false, hookStep = 'not-entered';
      measure(stage, () => { try { readBoundedReplayFile(source, 100_000, { [stage]: () => { hookReached = true;
        hookStep = 'rename'; renameSync(parent, moved); hookStep = 'mkdir'; mkdirSync(parent); hookStep = 'hardlink'; linkSync(join(moved, 'source.jsonl'), source); hookStep = 'complete'; } }); }
        finally { observations.push({ stage: stage + '-hook', hookReached, hookStep }); } });
    }
  } else if (name === 'subprocess') {
    const { runBoundedSubprocess } = await product('src/cli/bounded-subprocess.ts');
    const pids = () => existsSync(join(root, 'pids')) ? readFileSync(join(root, 'pids'), 'utf8').trim().split('\n').map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0) : [];
    const live = (owned) => owned.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    for (const [mode, timeoutMs, maxOutputBytes] of [['resistant', 500, 1024], ['descendant', 500, 1024], ['inherited-pipes', 500, 1024], ['combined', 2000, 1024], ['combined', 2000, 1200], ['overflow', 2000, 2048]]) {
      const offset = pids().length;
      measure(mode + '-' + maxOutputBytes, () => { const result = runBoundedSubprocess(process.execPath,
        [join(repo, 'tests/fixtures/process-bounds/child.mjs'), mode, join(root, 'pids')], { cwd: root, env: process.env, timeoutMs, maxOutputBytes });
        return { status: result.status, signal: result.signal, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr) }; });
      const owned = pids().slice(offset);
      observations.push({ stage: mode + '-liveness-at-return', owned, alive: live(owned) });
      if (mode === 'inherited-pipes') {
        await new Promise((done) => setTimeout(done, 100));
        observations.push({ stage: mode + '-liveness-100ms', owned, alive: live(owned) });
      }
    }
  } else {
    const { dryRunBoundedReplay, executeBoundedReplay } = await product('src/cli/replay.ts');
    const { planBoundedReplay } = await product('src/cli/replay-contract.ts');
    const plan = (dryRun = true) => planBoundedReplay({ source: 'claude-code', file, from: '2026-10-07T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z', maxBytes: 100_000, maxEvents: 10, dryRun });
    if (name === 'binding') cfg.privacy.includePaths = ['/allowed'];
    writeFileSync(file, row('one', name === 'binding' ? '/allowed/project' : root));
    let mergeCalls = 0;
    const mergeEvents = () => { mergeCalls++; return { events: [], added: 0 }; };
    if (name === 'healthy') {
      for (const args of [['init', '-q'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'initial'], ['remote', 'add', 'origin', 'https://reader:PRIVATE@git.example/team/fixture.git']]) {
        const result = spawnSync('git', args, { cwd: root, env: process.env, timeout: 2_000, stdio: 'pipe' });
        if (result.status !== 0) throw new Error('synthetic Git setup failed');
      }
      mkdirSync(join(process.env.HOME, '.tokenizer'));
      const queue = join(process.env.HOME, '.tokenizer/queue.jsonl'); writeFileSync(queue, JSON.stringify({ source: 'claude-code', sourceEventId: 'retained', occurredAt: '2020-01-01T00:00:00.000Z' }) + '\n');
      const before = sha(readFileSync(queue));
      const preview = measure('preview', () => dryRunBoundedReplay(plan(), cfg));
      observations.push({ stage: 'preview-read-only', unchanged: sha(readFileSync(queue)) === before });
      if (preview) measure('execute', () => executeBoundedReplay(plan(false), cfg, preview.planDigest, { readCurrentConfig: () => cfg }));
      observations.push({ stage: 'queue', containsCanary: /TW_RAW_CONTENT_CANARY|PRIVATE|reader/.test(readFileSync(queue, 'utf8')), retained: readFileSync(queue, 'utf8').includes('retained') });
    } else {
      const preview = measure('preview', () => dryRunBoundedReplay(plan(), cfg));
      if (preview) {
        if (name === 'binding') measure('bad-digest', () => executeBoundedReplay(plan(false), cfg, '0'.repeat(64), { readCurrentConfig: () => cfg, mergeEvents }));
        for (const [stage, changed] of [[name === 'binding' ? 'privacy-scope' : 'projectRoots', name === 'binding' ? { ...cfg, privacy: { ...cfg.privacy, includePaths: ['/different'] } } : { ...cfg, projectRoots: [root] }], ['privacy-mode', { ...cfg, privacy: { ...cfg.privacy, mode: 'sync' } }]]) {
          measure(stage, () => executeBoundedReplay(plan(false), cfg, preview.planDigest, { readCurrentConfig: () => changed, mergeEvents }));
        }
        if (name === 'binding') appendFileSync(file, row('changed', '/allowed/project'));
        measure('source-content', () => executeBoundedReplay(plan(false), cfg, preview.planDigest, { readCurrentConfig: () => { if (name !== 'binding') writeFileSync(file, row('two')); return cfg; }, mergeEvents }));
      }
      observations.push({ stage: 'merge-count', mergeCalls });
    }
  }
  console.log(JSON.stringify({ case: name, observations, releaseAcceptance: false }));
}
