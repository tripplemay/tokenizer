import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UsageEventInput } from "@/shared/usage";

export type StubRequest = { body: string; json: unknown; protocol: string | null };
export type StubPlan = (json: any, req: StubRequest, index: number) => [number, unknown];

export async function startStub(plan: StubPlan) {
  const requests: StubRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let json: unknown = null;
      try { json = JSON.parse(body); } catch { /* keep null */ }
      const record: StubRequest = { body, json, protocol: req.headers["x-tokenizer-batch-protocol"] as string ?? null };
      requests.push(record);
      const [status, payload] = plan(json, record, requests.length - 1);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, requests, url: `http://127.0.0.1:${port}` };
}

export function mkhome(home: string, serverUrl: string, mode: "sync" | "local-only" | "paused" = "sync") {
  const dir = join(home, ".tokenizer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    serverUrl,
    projectRoots: [join(home, "project")],
    sources: { claude: true, codex: true, opencode: true, aider: true, kimicode: true },
    privacy: { mode, includePaths: [], excludePaths: [] }
  }, null, 2) + "\n");
  writeFileSync(join(dir, "credentials.json"), JSON.stringify({ deviceToken: "stub-token" }) + "\n");
  writeFileSync(join(dir, "device.json"), JSON.stringify({
    id: "dev_stub", name: "stub-host", hostname: "stub-host", platform: "darwin"
  }, null, 2) + "\n");
}

export function event(sourceEventId: string, extra: Partial<UsageEventInput> = {}, occurredMinute = 0): UsageEventInput {
  return {
    source: "aider",
    sourceEventId,
    occurredAt: `2026-10-08T00:${String(occurredMinute).padStart(2, "0")}:00.000Z`,
    inputTokens: 1, outputTokens: 2, totalTokens: 3,
    ...extra
  };
}

let failures = 0;
export function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else { console.log(`FAIL: ${name}${detail ? " — " + detail : ""}`); failures += 1; }
}
export function summary(label: string) {
  console.log(`SUMMARY ${label} failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}
