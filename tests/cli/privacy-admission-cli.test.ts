import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
let server: Server | undefined;
const children: ChildProcess[] = [];
const cli = join(process.cwd(), "src", "cli", "index.ts");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tokenizer-admission-cli-"));
  mkdirSync(join(home, ".tokenizer"), { recursive: true });
  writeFileSync(join(home, ".tokenizer", "config.json"), JSON.stringify({
    serverUrl: "http://127.0.0.1:9",
    projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only", includePaths: ["/work/old"], excludePaths: [] }
  }));
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

function runCli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI did not finish")); }, 10_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function row(id: string, cwd: string) {
  return JSON.stringify({
    type: "assistant", uuid: id, cwd,
    timestamp: "2026-10-07T00:00:00.000Z", sessionId: "bounded-fixture",
    message: { role: "assistant", id: `msg-${id}`, model: "test-model", usage: { input_tokens: 10, output_tokens: 5 } }
  }) + "\n";
}

function pending() {
  const file = join(home, ".tokenizer", "queue.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}

describe("privacy admission CLI lifecycle", () => {
  it("previews without mutation, confirms into durable queue idempotently, and uploads only on the next sync", async () => {
    const tokenizer = join(home, ".tokenizer");
    const source = join(home, "explicit-history.jsonl");
    const queue = join(tokenizer, "queue.jsonl");
    const cursor = join(tokenizer, "cursor.json");
    writeFileSync(source, row("replayed", "/work/old"));
    writeFileSync(queue, JSON.stringify({
      source: "claude-code",
      sourceEventId: "retained-backlog",
      occurredAt: "2026-10-01T00:00:00.000Z"
    }) + "\n");
    writeFileSync(cursor, "{\"files\":{},\"opencodeLastTimeCreated\":0,\"claudeParserVersion\":2}\n");
    const queueBefore = readFileSync(queue, "utf8");
    const cursorBefore = readFileSync(cursor, "utf8");
    const args = [
      "replay", "--source", "claude-code", "--file", source,
      "--from", "2026-10-07T00:00:00.000Z", "--to", "2026-10-08T00:00:00.000Z",
      "--max-bytes", "100000", "--max-events", "10"
    ];

    const preview = await runCli([...args, "--sample", "1"]);
    expect(preview.code, preview.stderr).toBe(0);
    const previewJson = JSON.parse(preview.stdout);
    expect(previewJson).toMatchObject({ dryRun: true, selected: 1, wouldAdmit: 1 });
    expect(JSON.stringify(previewJson.sample)).not.toContain("/work/old");
    expect(readFileSync(queue, "utf8")).toBe(queueBefore);
    expect(readFileSync(cursor, "utf8")).toBe(cursorBefore);

    const first = await runCli([...args, "--execute", "--confirm", previewJson.planDigest]);
    expect(first.code, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ dryRun: false, admitted: 1, duplicates: 0, backlog: 2 });
    const second = await runCli([...args, "--execute", "--confirm", previewJson.planDigest]);
    expect(second.code, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ admitted: 0, duplicates: 1, backlog: 2 });
    expect(readFileSync(cursor, "utf8")).toBe(cursorBefore);
    expect(pending().map((event) => event.sourceEventId)).toEqual([
      "retained-backlog", "claude-jsonl:msg-replayed:replayed"
    ]);

    const requests: { events: { sourceEventId: string }[] }[] = [];
    server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => { text += chunk; });
      request.on("end", () => {
        const body = JSON.parse(text);
        requests.push(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ inserted: body.events.length, duplicates: 0, received: body.events.length }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture server address");
    writeFileSync(join(tokenizer, "credentials.json"), JSON.stringify({ deviceToken: "synthetic-fixture-token" }));
    expect((await runCli(["configure", "--privacy-mode", "sync", "--server-url", `http://127.0.0.1:${address.port}`])).code).toBe(0);
    expect(requests).toHaveLength(0);
    expect((await runCli(["sync"])).code).toBe(0);
    expect(requests[0].events.map((event) => event.sourceEventId)).toEqual([
      "claude-jsonl:msg-replayed:replayed", "retained-backlog"
    ]);
  }, 30_000);

  it("preserves admitted backlog and cursors, collects only later appends, then uploads on the next sync", async () => {
    const sourceDir = join(home, ".claude", "projects", "fixture");
    mkdirSync(sourceDir, { recursive: true });
    const file = join(sourceDir, "session.jsonl");
    writeFileSync(file, row("old-admitted", "/work/old") + row("previously-excluded", "/work/new"));
    expect((await runCli(["collect"])).code).toBe(0);
    expect(pending().map((event) => event.sourceEventId)).toEqual(["claude-jsonl:msg-old-admitted:old-admitted"]);
    const cursorPath = join(home, ".tokenizer", "cursor.json");
    const cursorBefore = readFileSync(cursorPath, "utf8");
    const fingerprintBefore = JSON.parse(readFileSync(join(home, ".tokenizer", "state.json"), "utf8")).lastCollectionScopeFingerprint;

    const configured = await runCli(["configure", "--include-path", "/work/new", "--exclude-path", "/work/old"]);
    expect(configured.code).toBe(0);
    expect(configured.stdout).toContain("Backlog: 1 previously admitted events");
    expect(configured.stdout).toContain("future incremental collection only");
    expect(readFileSync(cursorPath, "utf8")).toBe(cursorBefore);
    expect(pending()).toHaveLength(1);
    appendFileSync(file, row("fresh-new", "/work/new"));
    expect((await runCli(["collect"])).code).toBe(0);
    expect(pending().map((event) => event.sourceEventId)).toEqual([
      "claude-jsonl:msg-old-admitted:old-admitted", "claude-jsonl:msg-fresh-new:fresh-new"
    ]);
    const fingerprintAfter = JSON.parse(readFileSync(join(home, ".tokenizer", "state.json"), "utf8")).lastCollectionScopeFingerprint;
    expect(fingerprintAfter).not.toBe(fingerprintBefore);

    const requests: { events: { sourceEventId: string }[] }[] = [];
    server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => { text += chunk; });
      request.on("end", () => {
        const body = JSON.parse(text);
        requests.push(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ inserted: body.events.length, duplicates: 0, received: body.events.length }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture server address");
    writeFileSync(join(home, ".tokenizer", "credentials.json"), JSON.stringify({ deviceToken: "synthetic-fixture-token" }));
    const modeChange = await runCli(["configure", "--privacy-mode", "sync", "--server-url", `http://127.0.0.1:${address.port}`]);
    expect(modeChange.code).toBe(0);
    expect(modeChange.stdout).toContain("Backlog: 2 previously admitted events; automatic upload on the next Agent/run/sync cycle");
    expect(requests).toHaveLength(0);
    const status = await runCli(["status"]);
    expect(status.stdout).toContain("Backlog: 2 previously admitted events");
    expect(status.stdout).toContain(fingerprintAfter);
    const synced = await runCli(["sync"]);
    expect(synced.code, synced.stderr).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].events.map((event) => event.sourceEventId)).toEqual([
      "claude-jsonl:msg-old-admitted:old-admitted", "claude-jsonl:msg-fresh-new:fresh-new"
    ]);
    expect(JSON.stringify(requests)).not.toContain("scope-v1:");
    expect(pending()).toHaveLength(0);
  }, 30_000);

  it("keeps paused collection and replay execution from changing queue or cursor", async () => {
    const tokenizer = join(home, ".tokenizer");
    const queue = join(tokenizer, "queue.jsonl");
    const cursor = join(tokenizer, "cursor.json");
    const queued = JSON.stringify({ source: "claude-code", sourceEventId: "already-admitted", occurredAt: "2026-10-01T00:00:00.000Z" }) + "\n";
    writeFileSync(queue, queued);
    writeFileSync(cursor, '{"files":{},"opencodeLastTimeCreated":0,"claudeParserVersion":2}\n');
    expect((await runCli(["configure", "--privacy-mode", "paused"])).code).toBe(0);
    const queueBefore = readFileSync(queue, "utf8");
    const cursorBefore = readFileSync(cursor, "utf8");
    expect((await runCli(["collect"])).stdout).toContain("Collection paused");
    const source = join(home, "paused.jsonl");
    writeFileSync(source, row("paused", "/work/old"));
    const replay = await runCli([
      "replay", "--source", "claude-code", "--file", source,
      "--from", "2026-10-07T00:00:00.000Z", "--to", "2026-10-08T00:00:00.000Z",
      "--max-bytes", "100000", "--max-events", "10", "--execute", "--confirm", "0".repeat(64)
    ]);
    expect(replay.code).not.toBe(0);
    expect(replay.stderr).toContain("disabled while privacy mode is paused");
    expect(readFileSync(queue, "utf8")).toBe(queueBefore);
    expect(readFileSync(cursor, "utf8")).toBe(cursorBefore);
  }, 15_000);
});
