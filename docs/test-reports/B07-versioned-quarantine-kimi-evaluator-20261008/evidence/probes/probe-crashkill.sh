#!/bin/bash
# C6: SIGKILL crash consistency. 25 iterations: seed queue with a doomed event,
# fork a child that resolves it (quarantine -> checkpoint), SIGKILL at a random
# point, then assert: both files parse; the doomed event is either still queued
# or quarantined exactly once (never lost, never duplicated); a final resolution
# converges.
set -u
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
cd /Volumes/ORICO/project/.worktrees/tokenizer-b07-kimi-evaluator-20261008
H=/tmp/b07-eval/home-crash; rm -rf "$H"; mkdir -p "$H/.tokenizer"
cat > "$H/.tokenizer/config.json" <<EOF
{"serverUrl":"http://127.0.0.1:1","projectRoots":["$H/project"],"sources":{"claude":true,"codex":true,"opencode":true,"aider":true,"kimicode":true},"privacy":{"mode":"local-only","includePaths":[],"excludePaths":[]}}
EOF
VIOL=0
for i in $(seq 0 24); do
  # seed the doomed event via a fresh merge
  ITER=$i env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx -e '
    import { event } from "/tmp/b07-eval/probes/harness";
    (async () => {
      const { mergeQueueEvents } = await import("@/cli/queue");
      mergeQueueEvents([event(`crash-${process.env.ITER}`, { model: "bad" }, 0)]);
    })();' >/dev/null 2>&1
  ITER=$i env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx /tmp/b07-eval/probes/crash-child.ts "$H" >/dev/null 2>&1 &
  CHILD=$!
  # kill at a random sub-10ms point to land inside the resolve window
  usleep=$(python3 -c "import random; print(random.random()*0.01)")
  sleep "$usleep"
  kill -9 $CHILD 2>/dev/null
  wait $CHILD 2>/dev/null
  # verify invariants after the kill
  RESULT=$(ITER=$i env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx -e '
    import { readFileSync, existsSync, readdirSync } from "node:fs";
    (async () => {
      const { join } = await import("node:path");
      const dir = join(process.env.HOME!, ".tokenizer");
      const id = `crash-${process.env.ITER}`;
      let problems: string[] = [];
      let queued = 0, quarantined = 0;
      try {
        const q = readFileSync(join(dir, "queue.jsonl"), "utf8");
        queued = q.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((e: any) => e.sourceEventId === id).length;
      } catch (e) { problems.push("queue-unparseable"); }
      try {
        const rf = join(dir, "rejected-usage.jsonl");
        if (existsSync(rf)) {
          quarantined = readFileSync(rf, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r: any) => r.event?.sourceEventId === id).length;
        }
      } catch (e) { problems.push("quarantine-unparseable"); }
      if (queued + quarantined !== 1) problems.push(`count=${queued}+${quarantined}`);
      if (quarantined > 1) problems.push("quarantine-dup");
      console.log(problems.length ? "VIOLATION:" + problems.join(",") : "OK");
    })();' 2>/dev/null)
  if [ "$RESULT" != "OK" ]; then VIOL=$((VIOL+1)); echo "iter $i: $RESULT"; fi
  # convergent final resolution (idempotent replay)
  ITER=$i env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx -e '
    import { event } from "/tmp/b07-eval/probes/harness";
    (async () => {
      const { resolveQueueEvents } = await import("@/cli/queue");
      resolveQueueEvents({ accepted: [], rejected: [{ event: event(`crash-${process.env.ITER}`, { model: "bad" }, 0), code: "invalid_event" }] });
    })();' >/dev/null 2>&1
done
echo "crash iterations complete, violations=$VIOL"
[ $VIOL -eq 0 ] && echo "PASS: 25/25 SIGKILL iterations preserved parseability + no loss + no dup" || echo "FAIL: $VIOL violations"
# final convergence state
env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx -e '
  import { readFileSync, readdirSync } from "node:fs";
  (async () => {
    const { join } = await import("node:path");
    const dir = join(process.env.HOME!, ".tokenizer");
    const queue = readFileSync(join(dir, "queue.jsonl"), "utf8").split(/\r?\n/).filter(Boolean);
    const quar = readFileSync(join(dir, "rejected-usage.jsonl"), "utf8").split(/\r?\n/).filter(Boolean);
    const temps = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    console.log(`final: queue=${queue.length} quarantine=${quar.length} temps=${temps.length}`);
    console.log(queue.length === 0 && quar.length === 25 && temps.length === 0 ? "PASS: converged (25 quarantined, 0 queued, 0 temps)" : "FAIL: convergence");
  })();'