#!/bin/bash
# C3: two native processes racing exact-version merge vs ACK.
# Invariant: corrected version of every race-i ID survives the ACK of oldV;
# every worker's own events are either queued or ACKed exactly once; queue parses.
set -u
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
cd /Volumes/ORICO/project/.worktrees/tokenizer-b07-kimi-evaluator-20261008
H=/tmp/b07-eval/home-2proc; rm -rf "$H"; mkdir -p "$H/.tokenizer"
cat > "$H/.tokenizer/config.json" <<EOF
{"serverUrl":"http://127.0.0.1:1","projectRoots":["$H/project"],"sources":{"claude":true,"codex":true,"opencode":true,"aider":true,"kimicode":true},"privacy":{"mode":"local-only","includePaths":[],"excludePaths":[]}}
EOF
ITERS=40
env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx /tmp/b07-eval/probes/twoprocess-child.ts "$H" 0 $ITERS & P0=$!
env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx /tmp/b07-eval/probes/twoprocess-child.ts "$H" 1 $ITERS & P1=$!
W0=0; W1=0; wait $P0 || W0=$?; wait $P1 || W1=$?
echo "worker exits: w0=$W0 w1=$W1"
[ $W0 -eq 0 ] && [ $W1 -eq 0 ] && echo "PASS: both workers completed" || echo "FAIL: worker exit w0=$W0 w1=$W1"

env -u HTTP_PROXY -u HTTPS_PROXY HOME="$H" npx tsx - <<'EOF'
import { readFileSync } from "node:fs";
import { join } from "node:path";
const home = process.argv[2] ?? process.env.HOME!;
const dir = join(home, ".tokenizer");
const queueText = readFileSync(join(dir, "queue.jsonl"), "utf8");
let queue: any[] = [];
let parseOk = true;
try { queue = queueText.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); }
catch (e) { parseOk = false; }
console.log(`${parseOk ? "PASS" : "FAIL"}: queue parses after race (${queue.length} rows)`);
// Invariant 1: no corrected race version was deleted by the old-version ACK.
const corrected = queue.filter((e) => e.sourceEventId?.startsWith("race-") && e.model === "m-fixed");
console.log(`${corrected.length === 40 ? "PASS" : "FAIL"}: all 40 corrected versions survived old-version ACK (found ${corrected.length})`);
// Invariant 2: no old race version remains (they were ACKed).
const oldLeft = queue.filter((e) => e.sourceEventId?.startsWith("race-") && e.model === "m-old");
console.log(`${oldLeft.length === 0 ? "PASS" : "FAIL"}: old versions all ACKed (left ${oldLeft.length})`);
// Invariant 3: workers' own events are all present exactly once (no loss, no dup).
const own = queue.filter((e) => /^w[01]-evt-/.test(e.sourceEventId ?? ""));
const ids = own.map((e) => e.sourceEventId);
const dup = ids.length - new Set(ids).size;
console.log(`${own.length === 80 && dup === 0 ? "PASS" : "FAIL"}: 80 own events present, ${dup} duplicates`);
// Invariant 4: version identity is exact normalized JSON — same-ID different-content rows coexist.
const byId = new Map<string, number>();
for (const e of queue) byId.set(e.sourceEventId, (byId.get(e.sourceEventId) ?? 0) + 1);
console.log(`INFO: max rows per sourceEventId = ${Math.max(...byId.values())} (race ids have 1: only corrected remains)`);
// Invariant 5: no leftover temp files from torn writes.
import { readdirSync } from "node:fs";
const temps = readdirSync(dir).filter((f) => f.endsWith(".tmp") || f.includes(".steal."));
console.log(`${temps.length === 0 ? "PASS" : "FAIL"}: no temp/steal litter (${temps.join(",")})`);
const locks = readdirSync(dir).filter((f) => f.endsWith(".lock"));
console.log(`INFO: lock files left: ${locks.length === 0 ? "none" : locks.join(",")}`);
EOF
