#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? ".");
const expectation = process.argv[3];
if (!isAbsolute(repo) || !["baseline", "candidate"].includes(expectation)) {
  throw new Error("usage: b03-scope-admission-independent.mjs <absolute-repo> <baseline|candidate>");
}

const home = mkdtempSync(join(tmpdir(), "tokenizer-b03-independent-"));
const tokenizer = join(home, ".tokenizer");
const cli = join(repo, "src", "cli", "index.ts");
let server;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      cwd: repo,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timeout: ${args.join(" ")}`));
    }, 40_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function claudeRow(id, cwd) {
  return `${JSON.stringify({
    type: "assistant",
    uuid: id,
    cwd,
    timestamp: id === "fresh-new" ? "2026-10-08T00:00:00.000Z" : "2026-10-07T00:00:00.000Z",
    sessionId: "independent-admission",
    message: {
      role: "assistant",
      id: `msg-${id}`,
      model: "test-model",
      usage: { input_tokens: 10, output_tokens: 5 }
    }
  })}\n`;
}

function queueEvents() {
  const path = join(tokenizer, "queue.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function ids(events) {
  return events.map((event) => event.sourceEventId);
}

try {
  mkdirSync(tokenizer, { recursive: true });
  writeFileSync(join(tokenizer, "config.json"), JSON.stringify({
    serverUrl: "http://127.0.0.1:9",
    projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only", includePaths: ["/work/old"], excludePaths: [] }
  }));
  const sourceDir = join(home, ".claude", "projects", "fixture");
  mkdirSync(sourceDir, { recursive: true });
  const source = join(sourceDir, "session.jsonl");
  writeFileSync(source, claudeRow("old-admitted", "/work/old") + claudeRow("previously-excluded", "/work/new"));

  const firstCollect = await runCli(["collect"]);
  assert(firstCollect.code === 0, `first collect failed: ${firstCollect.stderr}`);
  const initialIds = ids(queueEvents());
  const cursorPath = join(tokenizer, "cursor.json");
  const cursorBeforeConfigure = existsSync(cursorPath) ? readFileSync(cursorPath, "utf8") : null;

  const configured = await runCli(["configure", "--include-path", "/work/new", "--exclude-path", "/work/old"]);
  assert(configured.code === 0, `scope configure failed: ${configured.stderr}`);
  const cursorAfterConfigure = existsSync(cursorPath) ? readFileSync(cursorPath, "utf8") : null;
  const afterConfigureIds = ids(queueEvents());

  appendFileSync(source, claudeRow("fresh-new", "/work/new"));
  const secondCollect = await runCli(["collect"]);
  assert(secondCollect.code === 0, `second collect failed: ${secondCollect.stderr}`);
  const afterRuleChangeIds = ids(queueEvents());

  const requests = [];
  let responseStatus = 200;
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ url: request.url, body: JSON.parse(body) });
      response.writeHead(responseStatus, { "content-type": "application/json" });
      if (responseStatus !== 200) {
        response.end(JSON.stringify({ error: "synthetic failure" }));
        return;
      }
      response.end(JSON.stringify({
        inserted: requests.at(-1).body.events.length,
        updated: 0,
        duplicates: 0,
        received: requests.at(-1).body.events.length
      }));
    });
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert(address && typeof address !== "string", "fixture server has no port");
  writeFileSync(join(tokenizer, "credentials.json"), JSON.stringify({ deviceToken: "fixture-token" }));
  const modeChange = await runCli(["configure", "--privacy-mode", "sync", "--server-url", `http://127.0.0.1:${address.port}`]);
  assert(modeChange.code === 0, `mode configure failed: ${modeChange.stderr}`);
  const requestsAfterConfigure = requests.length;
  const status = await runCli(["status"]);
  const synced = await runCli(["sync"]);
  assert(synced.code === 0, `sync failed: ${synced.stderr}`);
  const wireIds = requests.flatMap((request) => request.body.events.map((event) => event.sourceEventId));
  const wireContainsFingerprint = JSON.stringify(requests).includes("scope-v1:");

  const failedBacklog = {
    source: "claude-code",
    sourceEventId: "failed-sync-admitted",
    occurredAt: "2026-10-07T00:00:00.000Z",
    workspacePath: "/work/old",
    inputTokens: 1,
    outputTokens: 1
  };
  writeFileSync(join(tokenizer, "queue.jsonl"), `${JSON.stringify(failedBacklog)}\n`);
  responseStatus = 400;
  const failedSync = await runCli(["sync"]);
  const failedSyncQueuePreserved = JSON.stringify(ids(queueEvents())) === JSON.stringify(["failed-sync-admitted"]);

  writeFileSync(join(tokenizer, "queue.jsonl"), `${JSON.stringify({
    source: "claude-code",
    sourceEventId: "paused-admitted",
    occurredAt: "2026-10-07T00:00:00.000Z",
    workspacePath: "/work/old",
    inputTokens: 1,
    outputTokens: 1
  })}\n`);
  if (!existsSync(cursorPath)) {
    writeFileSync(cursorPath, '{"files":{},"opencodeLastTimeCreated":0,"claudeParserVersion":2}\n');
  }
  const pausedConfigured = await runCli(["configure", "--privacy-mode", "paused"]);
  assert(pausedConfigured.code === 0, `paused configure failed: ${pausedConfigured.stderr}`);
  const pausedQueueBefore = readFileSync(join(tokenizer, "queue.jsonl"), "utf8");
  const pausedCursorBefore = readFileSync(cursorPath, "utf8");
  const pausedCollect = await runCli(["collect"]);
  const pausedQueueAfter = readFileSync(join(tokenizer, "queue.jsonl"), "utf8");
  const pausedCursorAfter = readFileSync(cursorPath, "utf8");
  const replay = await runCli(["replay", "--source", "all", "--file", "/", "--execute"]);

  const result = {
    expectation,
    initialIds,
    afterConfigureIds,
    afterRuleChangeIds,
    cursorCreatedByCollect: cursorBeforeConfigure !== null,
    cursorUnchangedByConfigure: cursorBeforeConfigure === cursorAfterConfigure,
    requestsAfterConfigure,
    statusDisclosesBacklog: status.stdout.includes("Backlog:"),
    wireIds,
    wireContainsFingerprint,
    failedSyncCode: failedSync.code,
    failedSyncQueuePreserved,
    pausedCollectCode: pausedCollect.code,
    pausedOutputDisclosesPause: pausedCollect.stdout.includes("Collection paused"),
    pausedQueueUnchanged: pausedQueueBefore === pausedQueueAfter,
    pausedCursorUnchanged: pausedCursorBefore === pausedCursorAfter,
    replayUnavailable: replay.code !== 0 && replay.stderr.includes("unknown command")
  };

  const oldId = "claude-jsonl:msg-old-admitted:old-admitted";
  const excludedId = "claude-jsonl:msg-previously-excluded:previously-excluded";
  const freshId = "claude-jsonl:msg-fresh-new:fresh-new";
  assert(JSON.stringify(initialIds) === JSON.stringify([oldId]), "initial admission mismatch");
  assert(JSON.stringify(afterConfigureIds) === JSON.stringify([oldId]), "configure changed admitted backlog");
  assert(requestsAfterConfigure === 0, "configure uploaded backlog instead of deferring to sync");
  assert(!wireContainsFingerprint, "local scope fingerprint leaked onto the wire");
  assert(failedSync.code !== 0, "synthetic failed sync unexpectedly succeeded");
  assert(result.replayUnavailable, "replay CLI unexpectedly exists");

  if (expectation === "candidate") {
    assert(JSON.stringify(afterRuleChangeIds) === JSON.stringify([oldId, freshId]), "candidate rewrote backlog or replayed excluded history");
    assert(result.cursorCreatedByCollect && result.cursorUnchangedByConfigure, "candidate cursor contract failed");
    assert(JSON.stringify(wireIds) === JSON.stringify([freshId, oldId]), "candidate wire admission mismatch");
    assert(result.statusDisclosesBacklog, "candidate status omitted backlog disclosure");
    assert(result.failedSyncQueuePreserved, "candidate failed sync lost admitted backlog");
    assert(result.pausedOutputDisclosesPause && result.pausedQueueUnchanged && result.pausedCursorUnchanged, "candidate paused collection mutated durable state");
  } else {
    assert(afterRuleChangeIds.includes(excludedId) && afterRuleChangeIds.includes(freshId) && !afterRuleChangeIds.includes(oldId), "baseline negative was not reproduced");
    assert(!result.cursorCreatedByCollect, "baseline unexpectedly created incremental cursor");
    assert(!result.statusDisclosesBacklog, "baseline unexpectedly disclosed backlog semantics");
    assert(!result.failedSyncQueuePreserved, "baseline unexpectedly preserved excluded admitted backlog on failure");
    assert(!result.pausedQueueUnchanged, "baseline unexpectedly preserved paused admitted backlog");
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (server) await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(home, { recursive: true, force: true });
}
