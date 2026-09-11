# BL-HOMEPAGE-CODEX-QUOTA: independent evaluator dispatch preparation

Prepared at `2026-09-10T17:46:22Z` (local date: 2026-09-11).

## Scope and outcome

- Preparation only: no product code review, test execution, verdict, state transition, gate decision, commit, or push was performed by this preparation agent.
- The usable path is `dispatch-run.sh` -> `sandbox-profile.sh` -> `kimi -p <envelope_json> --output-format stream-json`.
- Target: `local-cli--kimi--evaluator`; `model_family=kimi`, independent of the assigned Codex Generator family. A new process and detached worktree are used; the adapter has no session/continue flags.
- Registry preflight and a sandbox-equivalent, no-tools Kimi connectivity probe passed. The full evaluator dispatch/artifact-return chain is deliberately NOT run yet.
- Do not use a same-family Codex subagent as acceptance. Kimi's `subagent` entry additionally requires the published strict VM provider; it is not needed for this local-cli path.

## Verified local prerequisites

Commands executed from `/tmp/tokenizer-homepage-codex-quota-20260911`:

```bash
kimi --version
kimi --help
bash .claude/dispatch/validate-dispatch.sh registry .agents-registry.json \
  --progress progress.json --adapters .claude/dispatch/transports/adapters
python3 .claude/dispatch/tool-catalog.py target \
  --registry .agents-registry.json \
  --adapters .claude/dispatch/transports/adapters \
  --target-id local-cli--kimi--evaluator
```

Observed:

| Item | Result |
| --- | --- |
| Executable | `/Users/yixingzhou/.kimi-code/bin/kimi` |
| Installed Kimi version | `0.40.1` |
| Registry validation | exit 0; 15 role capabilities |
| Target transport / role | `local-cli` / `evaluator` |
| Target family | `kimi` |
| Descriptor timeout | 2400 seconds |
| Sandbox HOME | `/Users/yixingzhou/.harness-sandbox/kimi` exists; none of the seven prohibited shell-init files exists |
| Authentication injection | `KIMI_CODE_HOME=~/.kimi-code`; directory existence checked, credential contents not read |
| Inherited adapter-specific env | `KIMI_CODE_HOME`, `KIMI_API_KEY`, `KIMI_BASE_URL` were all absent from caller environment |
| Execution provenance | `bf87fcda2da33def23c799ddf0d0c9a9626ef8ca7889a95fbe4d19313a1fb410` |
| Adapter execution contract hash | `113e802d56592c1327daee188c4ca44dbf3262dbd2a95585416412e781ce14dd` |

The adapter's historical seven-point verification is for Kimi 0.26.0. This preparation confirms current 0.40.1 prompt syntax, fresh invocation, dedicated-HOME startup, and authentication connectivity, not a fresh seven-point or product-acceptance signoff. No adapter or registry was edited to hide that version difference. Current help still has no worktree/CWD flag; the dispatcher supplies CWD.

### No-tools connectivity probe

An empty, non-repository probe directory was created with `mktemp -d /tmp/tokenizer-kimi-quota-probe.XXXXXX`; this run used `/tmp/tokenizer-kimi-quota-probe.W4uIF5`.

```bash
python3 .claude/dispatch/process-timeout.py \
  --timeout 60 --term-grace 2 \
  --status-file /tmp/tokenizer-kimi-quota-probe.W4uIF5/timeout.json \
  --cwd /tmp/tokenizer-kimi-quota-probe.W4uIF5 -- \
  env -i PATH="$PATH" \
  HOME=/Users/yixingzhou/.harness-sandbox/kimi \
  KIMI_CODE_HOME=/Users/yixingzhou/.kimi-code \
  LANG=en_US.UTF-8 TMPDIR=/tmp USER=yixingzhou SHELL=/bin/zsh \
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.pushurl \
  GIT_CONFIG_VALUE_0=DISABLED_BY_HARNESS_SANDBOX GIT_TERMINAL_PROMPT=0 \
  kimi -p 'Connectivity probe only. Do not use any tools, do not inspect files or repositories, do not run commands, do not change files, and do not perform any software review. Reply with exactly KIMI_CONNECTIVITY_OK.' \
  --output-format stream-json \
  > /tmp/tokenizer-kimi-quota-probe.W4uIF5/probe.stream.jsonl \
  2> /tmp/tokenizer-kimi-quota-probe.W4uIF5/probe.stderr.log
```

Observed status: `{"reason":"process_exit","exit_code":0}`. The stream contained version `0.40.1`, assistant text `KIMI_CONNECTIVITY_OK`, and a new-session resume hint only; no tool-use event. Stderr was empty. Do not resume this probe session for acceptance.

## Sandbox dependency seed: already prepared

`dispatch-run.sh` creates its own detached worktree from the immutable commit. Untracked `node_modules` from the caller is NOT carried across, and the current entrypoint has no prepare-only/pre-launch dependency hook. Do not pre-create the final worktree path: the dispatcher rejects it as duplicate task state.

A separate local dependency seed is ready:

```text
/tmp/tokenizer-quota-evaluator-deps-20260911/
  package.json
  package-lock.json
  node_modules/
```

Prepared using:

```bash
mkdir /tmp/tokenizer-quota-evaluator-deps-20260911
cp -cR node_modules /tmp/tokenizer-quota-evaluator-deps-20260911/node_modules
cp package.json package-lock.json /tmp/tokenizer-quota-evaluator-deps-20260911/
```

- Seed creation completed with exit 0. `node_modules` is a real directory, not a symlink to the Generator's active dependency directory.
- The seed contains local `vitest`, `prisma`, `tsc`, `next` executables and `node_modules/.prisma/client/index.js`.
- No `.env`, credentials, application source, build output, or evaluator conclusion was copied into the seed.
- `package-lock.json` SHA-256: `97188c338fcd59a7722779ab17427489b0cebbf021416e1a229b2b7ac57f2bc2`.
- Observed dependency versions: TypeScript 5.9.3, Vitest 2.1.9, Prisma/client 5.22.0, Next 15.5.18; runtime Node v25.7.0.
- These are dependency availability checks, NOT project test results or a claim that every installed package matches the lock. The Evaluator must run its own commands and report failures honestly.

Include these setup instructions in the evaluator contract so they run inside its new worktree before tests:

```bash
cmp package.json /tmp/tokenizer-quota-evaluator-deps-20260911/package.json
cmp package-lock.json /tmp/tokenizer-quota-evaluator-deps-20260911/package-lock.json
test ! -e node_modules
cp -cR /tmp/tokenizer-quota-evaluator-deps-20260911/node_modules ./node_modules
```

Run the copy only if BOTH `cmp` checks and `test` succeed. If the dependency manifest/lock changed, stop and rebuild a fresh seed for the locked snapshot; do not reuse it by assumption. Do not symlink dependencies and do not read `.env` from any other worktree. `TMPDIR=/tmp` keeps local socket paths short.

## Formal dispatch: run only after Generator handoff

The Coordinator must first persist the new batch/spec/features and the implementation into commits, complete the building -> verifying boundary, and select a fresh immutable acceptance commit. The setup-time HEAD `03351861b49c2858985b10be04b82a31100b78b7` is NOT an acceptance target. Uncommitted implementation changes will not appear in the evaluator worktree.

Before dispatch:

```bash
cd /tmp/tokenizer-homepage-codex-quota-20260911
git status --short
git rev-parse --verify HEAD
bash .claude/dispatch/validate-dispatch.sh registry .agents-registry.json
bash .claude/dispatch/validate-dispatch.sh assignments progress.json .agents-registry.json
bash .claude/dispatch/resolve-active-mode-role.sh \
  --role evaluator --expected-agent local-cli--kimi--evaluator \
  --progress progress.json --registry .agents-registry.json
```

`role_assignments=null` makes the assignments validator skip independence checking. The Coordinator must retain real Codex/Kimi provenance, not treat that skip as proof. A signed active v2 binding, if introduced for the batch, must actually resolve to Kimi local-cli; a mismatch/provenance drift must fail closed and cannot be bypassed with another registry or progress path.

The committed spec is `docs/specs/BL-HOMEPAGE-CODEX-QUOTA-spec.md` (planning commit `dddb4bd`). The evaluator covers `F001` through `F005`: F001-F004 are Generator features; F005 is the independent evaluation/UI feature. These are specification pointers, not implementation-quality claims.

Create the envelope with `apply_patch` after substituting the actual final committed SHA and a unique task ID. Do not include Generator quality claims or implementation discussion. Template (SHA/task placeholders are NOT dispatch-ready):

```json
{
  "task_id": "BL-HOMEPAGE-CODEX-QUOTA-verify-<sha12>-r0-a1",
  "contract_version": "harness/1.1",
  "batch": "BL-HOMEPAGE-CODEX-QUOTA",
  "role": "evaluator",
  "repo": {
    "url": "/tmp/tokenizer-homepage-codex-quota-20260911",
    "ref": "<full-lowercase-immutable-commit-sha>"
  },
  "spec": "docs/specs/BL-HOMEPAGE-CODEX-QUOTA-spec.md",
  "features": ["F001", "F002", "F003", "F004", "F005"],
  "l2_authorized": false,
  "contract": "You are the independent Kimi Evaluator in a new context. Read the locked checkout's AGENTS.md, harness-rules.md, CLAUDE.md, evaluator.md, state files, spec and acceptance criteria for F001-F005. Independently inspect the commissioned source and run your own tests. Do not treat implementation narratives, commit messages, Generator claims or existing PASS/FAIL reports as evidence. Before L1, require exact cmp matches for both package.json and package-lock.json against /tmp/tokenizer-quota-evaluator-deps-20260911, require node_modules to be absent, then copy only that seed's node_modules into this checkout with cp -cR. Do not install unapproved dependencies or read other worktrees' .env or credentials. Run npm run lint, npm run verify, npm run test, and npm run build in this checkout; redirect each command's full output to separate files under docs/test-reports/, record exit codes, and inspect bounded log excerpts rather than dumping full test logs into context. Add narrow independent regression tests when required. F005 requires real-component desktop and narrow-screen UI verification: create local fixture HTML by rendering the actual SubscriptionCard component with project-compiled CSS, never hand-built imitation cards. Before browser use read /Users/yixingzhou/.agents/skills/tabbit/SKILL.md. Use /Users/yixingzhou/.local/bin/tabbit-cli with a new task named quota-ui-review, navigate only to this task's localhost fixture, verify collapsed/expanded and keyboard behavior plus layout, and load returned screenshot artifacts for visual inspection. Do not inspect or claim unrelated tabs or use production/login state. Report any browser permission limitation honestly and do not give F005 PASS without the required UI evidence. Record exact command outcomes, inspected commit SHA, feature evidence and reproducible steps. You may write tests under tests/ or scripts/test/ and reports under docs/test-cases/ or docs/test-reports/; never modify product code, progress.json, features.json, backlog.json, pending_gate.decision, registry, adapter, or framework. Never commit or push. No production service, logged-in application tab, real account quota API, deployment, or L2 action is authorized. If acceptance needs L2, write waiting=auth and precise waiting_detail, then exit 0; if criteria need adjudication, write waiting=adjudication. Do not fabricate a PASS for an unexecuted check. Write the deliverable artifact exactly at the commissioned path, with only the schema's allowed fields. State explicitly that production was not deployed and the local fixture does not verify production login/collection. Return without changing the batch stage.",
  "deliverable": {
    "artifact": "docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-verdict.json",
    "schema": ".claude/autonomous/verdict-artifact.schema.json",
    "commit_to": null
  },
  "deadline_s": 2400
}
```

If additional acceptance needs L2, the Coordinator must obtain and explicitly scope the user's authorization rather than silently changing `l2_authorized`. The proposed contract covers L1 and the explicitly authorized localhost real-component fixture. Spec/features must still be read from the final disk state.

Assuming the completed envelope is stored at `docs/analysis/2026-09-11-codex-quota/evaluator-envelope.json`, the actual invocation is:

```bash
bash .claude/dispatch/validate-dispatch.sh envelope \
  docs/analysis/2026-09-11-codex-quota/evaluator-envelope.json
TMPDIR=/tmp bash .claude/dispatch/dispatch-run.sh \
  --agent local-cli--kimi--evaluator \
  --envelope docs/analysis/2026-09-11-codex-quota/evaluator-envelope.json \
  --registry .agents-registry.json \
  --workroot /tmp/tokenizer-quota-evaluator-runs-20260911 \
  --state .harness-dispatch
```

The entrypoint is blocking. Its stdout is run-meta JSON, not the verdict. The effective deadline is `min(envelope.deadline_s, descriptor.timeout_s)`, here 2400 seconds. It does not automatically copy artifacts or update any batch state.

### Bounded L1 logs

The Evaluator should keep full output on disk and return a compact command/exit summary. Example to run inside its worktree (not executed during preparation):

```bash
EVIDENCE=docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-evidence
mkdir -p "$EVIDENCE"
for script in lint verify test build
do
  npm run "$script" > "$EVIDENCE/l1-$script.log" 2>&1
  rc=$?
  printf '%s\t%s\n' "$script" "$rc" >> "$EVIDENCE/l1-exits.tsv"
  tail -n 30 "$EVIDENCE/l1-$script.log"
done
```

Use a shell without `errexit` for this collection loop so a failure is recorded instead of silently aborting before the exit table. A successful loop exit is not evidence that all commands passed: inspect every row of `l1-exits.tsv`. Keep logs and narrow regression output with the returned report.

### F005 browser preparation and limits

- Read `/Users/yixingzhou/.agents/skills/tabbit/SKILL.md` before operating the browser. Because sandbox HOME differs from user HOME, use the absolute stable launcher `/Users/yixingzhou/.local/bin/tabbit-cli`, not `$HOME/.local/bin/tabbit-cli` and not a binary inside the app bundle.
- Launcher `--help` returns a usage error with exit 70; this is not evidence of an unavailable browser. A separate `diagnose` call under the same empty env/dedicated HOME completed with exit 0 and `ok=true` during preparation. Capability output reports Playwright core/expect 1.62.1, screenshot/locator/ARIA routes, 60-second default executor deadline and 180-second maximum. No task, tab, navigation, fixture, or UI acceptance was created/performed by the preparation agent.
- The Evaluator creates the new task `quota-ui-review` using `nodejs --task quota-ui-review --request-id <unique-request>`. Reuse that task name. Do not inventory/claim unrelated tabs. The first execution provides the task-owned `page`; use it for the first localhost fixture.
- Serve only the evaluator's fixture assets on `127.0.0.1`; the fixture must render actual source components and include project CSS. Put source/script/HTML artifacts under the permitted evaluator test/report directories. Do not start a production-connected application or copy real sessions/cookies.
- Use desktop and narrow viewport widths (for example 1440 and 390 CSS pixels). Capture and inspect actual layout, stale/unknown text, the single Codex region, native details default state, expansion and keyboard operation using both required locales and representative fixtures. Kimi selects the exact DOM locators from the rendered component, not from this preparation note.
- Submit browser JS through stdin. A navigation/screenshot program is NOT `--read-only`; use that flag only for truly non-mutating inspection programs. Keep individual browser submissions below their known executor deadline.
- `page.screenshot()` returns a receipt; load the file at `result.nextAction.path`. A path returned without image inspection is not visual QA. Preserve the real screenshot as report evidence; do not generate replacement artwork.
- Finish the task with `tabbit-cli finish --task quota-ui-review` exactly once after task-owned scratch cleanup. Do not use `--discard` to close retained or unrelated user pages.
- The sandbox-equivalent `diagnose` is only a launcher/control-plane preflight. Actual screenshot, viewport, tool permissions and UI interaction remain unverified until F005. If unavailable, record the exact failure/limitation as PARTIAL or appropriate waiting state; never claim F005 PASS from SSR strings alone.

## Return artifacts and mechanical acceptance

Expected paths (`TASK_ID` means the exact envelope task ID):

```text
<project>/.harness-dispatch/run-meta-TASK_ID.json
/tmp/tokenizer-quota-evaluator-runs-20260911/run-TASK_ID.log
/tmp/tokenizer-quota-evaluator-runs-20260911/timeout-TASK_ID.json
/tmp/tokenizer-quota-evaluator-runs-20260911/BL-HOMEPAGE-CODEX-QUOTA-local-cli--kimi--evaluator-TASK_ID/
  docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-verdict.json
```

Run-meta fields include `task_id`, `agent_id`, `model_family`, `transport`, `role`, `batch`, `ref`, `deliverable`, `worktree`, `artifact`, `log`, `envelope_path`, `outcome`, `exit_code`, `duration_s`, `effective_timeout_s`, `descriptor_timeout_s`, `termination_reason`, and optional usage fields.

The verdict JSON schema permits only:

- Required top level: `batch_id`, `fix_round`, `created_at` (UTC RFC 3339), `verdicts`.
- Optional: `waiting` (`null`, `auth`, or `adjudication`) and `waiting_detail` (required when waiting).
- Each verdict: `feature_id`, `result` (`PASS`, `PARTIAL`, `FAIL`), nonempty `evidence`, nonempty `steps_to_reproduce`.
- No top-level task ID, commit SHA, report path, evaluator name, summary, or test-count extension is allowed. Put commit/command evidence in the evidence string and/or a separate report. Do not write a prefilled PASS template.
- `waiting=null` requires a nonempty verdict array. Waiting permits an empty/partial array, but the missing verification must be explicit.
- The receipt implementation requires the EXACT fixed batch artifact path above; a task-suffixed verdict filename may pass the envelope pattern but will be rejected by completed-receipt validation.

For a returned run-meta:

```bash
bash .claude/dispatch/validate-dispatch.sh receipt \
  .harness-dispatch/run-meta-TASK_ID.json \
  --expected-envelope docs/analysis/2026-09-11-codex-quota/evaluator-envelope.json \
  --project-root /tmp/tokenizer-homepage-codex-quota-20260911
bash .claude/autonomous/validate-verdict-artifact.sh \
  /absolute/artifact/path/from/run-meta.json
git -C /absolute/worktree/path/from/run-meta.json status --short
git -C /absolute/worktree/path/from/run-meta.json diff --name-only
git -C /absolute/worktree/path/from/run-meta.json diff --cached --name-only
```

The `/absolute/...` tokens above mean JSON field values, not literal directories. For an active v2 batch, also supply the freshly reverified role/target JSON to receipt validation as required by that checkpoint. Keep the commissioned envelope and validate `batch`, `ref`, role/family, expected feature coverage, and unchanged product/state files before returning evidence. The local-cli worktree is a cooperative guardrail, not hostile-process filesystem isolation; unlike the strict bridge, it does not mechanically reject every source mutation by itself.

Receipt exit/status semantics:

- `0 / COMPLETED`: artifact returned and content validation passed. This is transport completion, NOT automatically an all-PASS acceptance.
- `3 / AUTH_REQUIRED` or `INPUT_REQUIRED`: stop and present the untouched waiting artifact.
- `4 / FAILED`, `CANCELED`, or `ARTIFACT_INVALID`: retain evidence; at most one controlled retry, then hard stop. Reusing an existing task/worktree path is rejected; preserve the first run and use a new attempt task ID for an authorized retry.
- Exit 0 with missing artifact is FAILED, not success. A vendor self-exit 124 is not necessarily dispatcher timeout.

Only the Coordinator copies the verdict/reports/tests back after boundary checks. Copy verdict bytes unchanged and confirm SHA-256 equality; do not rewrite PASS/PARTIAL/FAIL or waiting conclusions. Do not clean the evaluator worktree/logs before importing and preserving the evidence. Human gate decisions and production deployment remain outside this preparation.

## Local source references

- `harness-rules.md`: fresh context, cross-family independence, evaluator write boundary.
- `.claude/dispatch/transports/local-cli.md`: transport contract, sandbox and receipt semantics.
- `.claude/dispatch/transports/adapters/kimi.json`: prompt argv, fresh-context flags, auth directory.
- `.claude/dispatch/dispatch-run.sh`: registry/active-role/provenance preflight and routing.
- `.claude/dispatch/sandbox-profile.sh`: detached worktree, env allowlist, dedicated HOME, timeout, run-meta paths.
- `.claude/dispatch/dispatch-envelope.schema.json`: closed envelope and immutable ref.
- `.claude/autonomous/verdict-artifact.schema.json`: closed verdict artifact.
- `.claude/dispatch/validate-dispatch.sh`: fixed evaluator artifact path and receipt result.

No conclusions from older product acceptance reports or Generator implementation discussion were used in this preparation.
