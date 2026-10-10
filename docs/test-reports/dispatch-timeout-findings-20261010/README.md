# Dispatch timeout findings (supporting analysis only)

`release_ready=false`; new acceptance is **BLOCKED**. This is an independent
supporting fault analysis under harness section 1.5, not a Generator/Evaluator
signoff or a state transition. Its hard stop applies to this evaluation chain,
not the entire user goal. Full facts, source lines and SHA256s: `analysis.json`.

## Result

- Both tasks used source `5c5c283b08d225b42d8db19abcbe5d3c1f562ac4`, target
  `local-cli--kimi--evaluator`, descriptor cap2400 and effective timeout1800.
  Originals remain r1 `TIMEOUT/124/deadline/1802s` and r2
  `TIMEOUT/124/deadline/2305s`. Do not rewrite r2 to1800.
- Original timeout sidecars confirm `deadline/124`; durable run-meta exists in
  the custom dispatch-state directory and semantically equals each receipt.
  r2 log birth to sidecar creation spans2305 integer seconds. Thus2305 is not
  merely a receipt-copy discrepancy.
- **The extra505 seconds are unexplained.** The existing metadata records no
  deadline-detection, TERM/KILL or reap timestamp/PID. The last r2 log write is
  earlier than the nominal bound; it does not prove Kimi ran beyond1800.
  Suspend/clock/scheduling/inspection/reaping are possibilities, not findings.
- Both required verdict paths are absent. Original validation is `CANCELED`;
  the corresponding validator branch returns4. r2 already consumed the one
  allowed re-dispatch. No third attempt, gate weakening or longer bound.

## What current code explains

`dispatch-run.sh` resolves the registered target then execs `sandbox-profile.sh`.
There is no separate `local-cli-runner.sh`. The adapter renders:

```text
kimi -p <one inline envelope JSON argument> --output-format stream-json
```

The helper launch is structurally:

```text
python3 process-timeout.py --timeout 1800 --term-grace 2
  --status-file <R/timeout-task.json> --cwd <evaluation worktree> --
  env -i <allowlisted environment> <Kimi argv>
```

These are code-derived argv shapes, not a captured historic invocation.
`--timeout-helper` is supported; originals do not log the helper digest/argv,
so historic override absence is unknown. Current dispatch files are unchanged
from the evaluation commit and match repair disk and framework template copies.

The runner records `START=date +%s`, directly redirects to the regular log,
waits for the helper, then computes elapsed seconds **before** usage extraction
and metadata writing. No outer `tee` or pipe-drain stage exists. Kimi's own
Bash commands using `tee|tail` are a different layer.

The helper uses `time.time()+timeout`, a new process session and20ms polling.
After deadline it inspects descendant groups, sends TERM, allows2 seconds,
then KILL/reap, and only then writes `deadline/124`. The `ps check_output`
and fallback `proc.wait()` have no timeout. These are concrete unbounded
cleanup points, **not proof that either consumed the extra505 seconds**.

API fields do not close this evidence gap: the CLI scanner derives missing
start/end from meta mtime and duration and scans only project-root
`.harness-dispatch`, not the custom state directory. The report API persists
client-supplied times. No API query was performed; historic ingestion is unknown.

## Partial output is not acceptance

r1 recorded existing122 pass and verify/lint exits0, then wrote a40570-byte
own test that has no recorded execution/verdict. r2 preserved these distinct
original own-control outputs:

| File | Original facts | Start at (verbatim) | Duration |
| --- | --- | --- | --- |
| `03-r2-controls-raw.log` |61 failed /10 passed; null shape, `missing_tools`,35 vs34 |22:44:05 |1.84s |
| `04-r2-controls-corrected-raw.log` |3 failed /68 passed; tail14 vs12,9 vs10, `fi` boundary assertion |22:45:42 |24.84s |
| `05-r2-controls-final-raw.log` |1 failed /70 passed; tail14 vs12 |22:46:48 |25.03s |
| `06-r2-controls-final2-raw.log` |71 passed after own-test edits, no verdict |22:47:37 |25.35s |

Initial failures remain facts; later green does not demonstrate correction
legitimacy or substitute for independent deliverable acceptance. r2's initial
`npm ci` and verify/lint command outputs used `tail -5`; complete capture of
all initial commands is not proven by the copied final logs.

## Read-only replay commands

Run from the analysis worktree. These inspect existing files only; they do not
rerun tests, the helper, validator or model. Root aliases correspond to
`analysis.json`. Public-health evidence is deliberately outside this analysis.

```bash
P=/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008
C="$P/docs/test-reports/BL-RELEASE-READINESS-coordination-20261009"
R=/Volumes/ORICO/project/.worktrees/tokenizer-compose-shape-evaluation-20261009
S=/Volumes/ORICO/project/.worktrees/tokenizer-compose-shape-dispatch-state-20261009
git rev-parse HEAD
git diff --exit-code 5c5c283b08d225b42d8db19abcbe5d3c1f562ac4 \
  2074991717abaf3cb34d9aad894bcd4357fefbc3 -- \
  .claude/dispatch/dispatch-run.sh .claude/dispatch/sandbox-profile.sh \
  .claude/dispatch/dispatch_common.py .claude/dispatch/process-timeout.py \
  .claude/dispatch/tool-catalog.py .claude/dispatch/transports/adapters/kimi.json \
  .claude/dispatch/validate-dispatch.sh .agents-registry.json
ls -la "$S"
stat -f '%N size=%z mtime_epoch=%m birth_epoch=%B' \
  "$R/run-compose-version-shape-5c5c283-kimi-support-r1.log" \
  "$R/timeout-compose-version-shape-5c5c283-kimi-support-r1.json" \
  "$R/run-compose-shape-5c5c283-kimi-support-r2-once.log" \
  "$R/timeout-compose-shape-5c5c283-kimi-support-r2-once.json"
node -e 'const fs=require("fs"),c=require("crypto");for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);console.log(c.createHash("sha256").update(b).digest("hex"),f);}' \
  "$C/compose-shape-kimi-r2-receipt-original.json" \
  "$C/compose-shape-kimi-r2-runtime-original.log" \
  "$R/run-compose-shape-5c5c283-kimi-support-r2-once.log" \
  "$S/run-meta-compose-shape-5c5c283-kimi-support-r2-once.json"
node -e 'const fs=require("fs");for(const f of process.argv.slice(1)){const a=fs.readFileSync(f,"utf8").split("\n");let e=[];a.forEach((s,i)=>{try{const o=JSON.parse(s);e.push({line:i+1,o});}catch{}});console.log(f,"events",e.length);for(const {line,o} of e){for(const t of o.tool_calls??[]){const fn=t.function??t;let x=fn.arguments;try{x=typeof x==="string"?JSON.parse(x):x;}catch{}if(fn.name==="Bash"||fn.name==="Write")console.log(JSON.stringify({line,name:fn.name,command:x?.command,path:x?.path}));}}}' \
  "$R/run-compose-shape-5c5c283-kimi-support-r2-once.log"
```

## Minimal next diagnostic (proposed, not executed)

Separately authorize a short standard-library mock-only helper investigation:
cooperative/TERM-ignoring children, same-group/new-session descendants, an
inherited stdout handle with regular-file versus piped capture, and the existing
`--clock-file` test hook. Direct helper timeout1-2 seconds is a test parameter,
not a change to envelope1800 or descriptor2400. Record wall/monotonic phase times
and only owned mock PIDs/PGIDs under an independent short watchdog. An isolated
instrumentation copy can bracket `ps` and reap without editing framework files.

Keep unmodified and instrumented results, originals and hashes separate.
Synthetic reproduction may identify a mechanism but cannot prove historic r2
causation. No model rerun, native long run, dependency/network/credential access,
framework repair or acceptance reopening is included in this proposal.
