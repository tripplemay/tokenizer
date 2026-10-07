// Privacy minimization + fresh-dir permissions.
// Quarantined and queued rows must be minimized (no raw payloads, sanitized git
// identity) and state files 0600; product-created state dir 0700.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { event, check, summary } from "./harness";

const home = process.argv[2];

async function main() {
  // Deliberately NO pre-created .tokenizer dir: the product must create it 0700.
  const { mergeQueueEvents, resolveQueueEvents, readQueue } = await import("@/cli/queue");
  const dirty = event("privacy-1", {
    gitRemote: "https://oauth2:secret-token@github.com/acme/private-repo.git",
    repoKey: "https://user:pw@gitlab.com/acme/repo.git",
    gitBranch: "feature/jane-doe-payroll-fix",
    workspacePath: "/Users/janedoe/secret-project",
    rawJson: { payload: { message: { content: "FULL SOURCE PAYLOAD SHOULD NEVER PERSIST" } } },
    // unknown additive field a buggy minimizer might carry through
    ...({ debugNotes: "raw prompt contents" } as object)
  });
  const codexDirty = event("privacy-codex", {
    source: "codex",
    rawJson: { payload: { info: { total_token_usage: {
      input_tokens: 1, cached_input_tokens: 2, cache_write_input_tokens: 3,
      output_tokens: 4, reasoning_output_tokens: 5, total_tokens: 10
    }, other: "DROP" }, text: "DROP-TEXT" } }
  });
  mergeQueueEvents([dirty, codexDirty]);

  const queued = readQueue();
  const q0 = queued.find((e) => e.sourceEventId === "privacy-1")!;
  check("queue: gitRemote credential stripped", q0.gitRemote === "https://github.com/acme/private-repo.git", String(q0.gitRemote));
  check("queue: repoKey sanitized (no creds, no userinfo)", q0.repoKey !== null &&
    !q0.repoKey!.includes("@") && !q0.repoKey!.includes("user:pw") && !q0.repoKey!.includes("://"),
    String(q0.repoKey));
  // remote-derived identity wins when both are present; the credentials are gone either way.
  check("queue: repoKey identity is one of the sanitized inputs",
    ["github.com/acme/private-repo", "gitlab.com/acme/repo"].includes(q0.repoKey!), String(q0.repoKey));
  // repoKey-only credential input must still be stripped.
  mergeQueueEvents([event("privacy-2", { repoKey: "https://user:pw@gitlab.com/acme/only-key.git" })]);
  const q2 = readQueue().find((e) => e.sourceEventId === "privacy-2")!;
  check("queue: repoKey-only creds stripped", q2.repoKey === "gitlab.com/acme/only-key", String(q2.repoKey));
  // unparseable remote falls back to null rather than persisting raw text.
  mergeQueueEvents([event("privacy-3", { gitRemote: "not a url at all {{{" })]);
  const q3 = readQueue().find((e) => e.sourceEventId === "privacy-3")!;
  check("queue: unparseable gitRemote nulled", q3.gitRemote === null, String(q3.gitRemote));
  check("queue: non-codex rawJson dropped", !("rawJson" in q0));
  check("queue: unknown field dropped", !("debugNotes" in q0));
  check("queue: branch/path retained as identity-minimized scalars",
    q0.gitBranch === "feature/jane-doe-payroll-fix" && q0.workspacePath === "/Users/janedoe/secret-project");
  const qc = queued.find((e) => e.sourceEventId === "privacy-codex")!;
  check("queue: codex rawJson minimized to cumulative counters only",
    JSON.stringify(qc.rawJson) === JSON.stringify({ payload: { info: { total_token_usage: {
      input_tokens: 1, cached_input_tokens: 2, cache_write_input_tokens: 3,
      output_tokens: 4, reasoning_output_tokens: 5, total_tokens: 10 } } } }),
    JSON.stringify(qc.rawJson));

  resolveQueueEvents({ accepted: [], rejected: [{ event: dirty, code: "invalid_event" }, { event: codexDirty, code: "invalid_event" }] });
  const rejectedRaw = readFileSync(join(home, ".tokenizer", "rejected-usage.jsonl"), "utf8");
  check("quarantine file: no source payload text", !rejectedRaw.includes("FULL SOURCE PAYLOAD SHOULD NEVER PERSIST"));
  check("quarantine file: no credential", !rejectedRaw.includes("secret-token") && !rejectedRaw.includes("oauth2:secret"));
  check("quarantine file: no unknown debug field", !rejectedRaw.includes("debugNotes") && !rejectedRaw.includes("raw prompt contents"));
  check("quarantine file: no dropped codex text", !rejectedRaw.includes("DROP-TEXT"));

  const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);
  const dir = join(home, ".tokenizer");
  check("product-created .tokenizer dir mode 700", mode(dir) === "700", mode(dir));
  check("queue.jsonl 600", mode(join(dir, "queue.jsonl")) === "600");
  check("rejected-usage.jsonl 600", mode(join(dir, "rejected-usage.jsonl")) === "600");
  const lock = readdirSync(dir).filter((f) => f.endsWith(".lock"));
  check("no locks left", lock.length === 0, lock.join(","));
  summary("privacy-perms");
}

main();
