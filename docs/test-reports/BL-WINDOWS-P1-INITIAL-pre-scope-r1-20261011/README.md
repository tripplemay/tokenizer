# Windows P1 INITIAL: independent pre-scope revision 1 review

**PASS, scope-only: B001 minimum written closure is complete.** This is an
independent supporting specification critic result, not implementation,
functional Evaluator acceptance, native execution approval or release signoff.
All implementation/publication/native/release authority flags remain false.

Source: `c05d6b4b2168ade9a66a3eacd337f766d68e5f70`; parent:
`11c32d5806372ef3f7a7e9285d40f3b9c9e24a9b`; original bindings:
`c58434f9791b944c0414b83830bc1ea412aa1b2d`.
Starting worktree was clean on `codex/windows-p1-initial-scope-r1-20261011`.

## Decisive B001 evidence

- `BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json:125-144` requires the explicit
  `metadataSource` and thirteen `allOf` branches. Normal completed/refused
  outcomes require actual API return, worker `ok`, null error fields and null
  signal; refusal additionally requires nonzero safe returned status.
  `refused/status=1/launch-error/EIO`, and EIO alone, are rejected.
- The actual frozen API throws without return status/signal
  (`bounded-subprocess.ts:94-104,107-111`). Timeout/output/supervision have no
  code-bearing constructor; only launch has actual optional `.code` (`4-9`).
  Revision timeout requires actual throw, worker `timeout`, null status/signal
  and null code. Invented status 0, EIO or signal is rejected. Unsupported or
  diagnostic errors cannot be relabelled as product errors. Safe errorName
  denotes the observed API class, not an error message or guessed worker result.
- `md:62-64` and `json:69-74,193-198` require all four unique native guard/trace
  `child-exit` and `child-close` tuples to belong to the same admitted handle,
  childPid, owning worker, case/root and exact script/argv; all mutually equal,
  and on normal return equal API status/signal. Guard callbacks really record
  those native fields (`native-runtime-parity.mjs:238-245`); old trace does so on
  the same returned handle (`trace-preload.mjs:63-73`). Worker `ok` takes its
  native status/signal from close (`bounded-subprocess-worker.mjs:84-89`).
  Trace `spawn-sync` status/signal is instead the Node worker result (`75-85`),
  explicitly not a substitute. No new worker field or query is required.
- Throw-path native exit/close remains independent evidence, never a replacement
  for unavailable API return fields. Missing, duplicate, wrong-owned or
  contradictory source/error/worker/exit-close facts require unknown, reject the
  raw tuple and stop T1/T2. A canonical returned refusal versus native status0
  must therefore stop, even though its isolated native JSON shape is valid.
- `md:48,64,66-73,88` and `json:192-199,212` retain independent EOF, health,
  cleanup, provenance and counter requirements. Only clean T1 empty-prefix or
  T2 json-enter-only refusal/timeout may progress. Contradictory tuples at both
  boundaries must produce unknown and no next native launch. These are explicit
  future controls, not controls executed in this review.

JSON Schema alone cannot authenticate an actual return/throw instance or compare
external guard/trace records. The documents explicitly require both strict
schema validation and those cross-field checks; no decision is left to Generator
for the B001 conflicts. Unknown outcome tuples may preserve safe independently
observed fields, but are not eligible clean outcomes.

## Scope remained narrow

Parent-to-source diff changes only the two binding documents. Parent bindings
are byte-equal to c584 originals; the original BLOCKED report pair is byte-equal
to parent and has not been rewritten. All four scripts/hashes, T0-T3, tokens,
selection table, environment, bounds/caps, native command/argv, three future
paths, append mechanism, modes, workflow and sealing/upload bindings are
unchanged. Twenty-six other schema definitions are unchanged. Only native
source/tuple closure, associated cross-fields and one required B001 future
control were tightened. The three future source paths remain absent.

No T4/T5, module/P2/downstream, environment repair, retry, discarded-worker-stdout
read, worker edit, native/host query or additional artifact surface was added.

## Actual checks and input identity

Every Git invocation used `-c core.fileMode=false`.

1. `git status --short --branch`; `git rev-parse HEAD HEAD^`: clean start and
   exact source/parent above.
2. `git diff --name-status <parent> <source>`; `git diff --check <parent> <source>`;
   `git diff --name-status <c584> <parent>`; `git diff --numstat <c584> <source>`;
   full `git diff --unified=5 <parent> <source> -- <two binding paths>`:
   exactly the stated paths; whitespace check exit 0; full changes reviewed.
3. Offline `node <<'NODE'` builtins-only JSON/hash/comparison checker, using
   fs/crypto/assert and read-only `git show`: ten referenced input hashes,
   four script hashes, 49 local schema references, fifteen exact-key object
   schemas, 26 unchanged other definitions, sixteen upload files and fifteen
   manifest entries verified. Both historical binding blobs independently
   reproduce original hashes. Byte preservation of the old reports verified.
4. Offline `node <<'NODE'` native-schema evaluator audited every reachable
   keyword: `$ref,type,additionalProperties,required,properties,allOf,if,then,
   enum,const,anyOf,minimum,maximum,not`. Fourteen canonical tuples accepted;
   fifteen named contradictions rejected. Independently enumerated 72,576
   combinations, not the author's eight examples: eight outcomes, four sources,
   seven statuses, three signals, six error names, three codes, six worker kinds,
   elapsed=1. Seventy-five shapes accepted, of which five clean outcome shapes
   all obey the required return/timeout relation. Domain values and named
   controls are recorded in verdict.json. This is an exact native-keyword
   static check, not a general schema package, product test or implemented
   selector execution. Output throw with workerKind=ok remains structurally
   possible because the frozen API can throw during response decoding.

Current reviewed documents:

| Input | Bytes | SHA-256 |
|---|---:|---|
| bindings MD | 19264 | `bf60ca426602d00b76515091cc30abd37badea21731b6ad21fe54cd323d7577c` |
| bindings JSON | 34330 | `ed24ebf3b4b1890f84f09ba82edd0d71f75a12e35504a84a3fb0f9d8300455fc` |

The JSON report records all fourteen current input hashes, both original
binding hashes, exact evidence locations, actual methods and not-performed
boundaries. The previous 59-file native inventory and remote execution were
not re-authenticated. No later health metadata was used.

## Remaining gates

No B001 scope blocker remains. Explicit Coordinator scope/implementation
authority is still separate. Actual three-file implementation and independent
diff review, B001 T1/T2 mocked controls and all declared synthetic controls,
listener/lock/sealing correctness, actual EOF/health/cleanup/provenance,
different-model-family functional acceptance, native exact-candidate evidence,
publication authority and release gates remain unperformed/open.

No native/probe/product execution, network, installation, CI, push, production,
source/workflow/test/state/harness/memory change or human gate write occurred.
Only this README and adjacent verdict.json are reviewer outputs. Main batch
status is not transitioned and the previous BLOCKED verdict remains original.
