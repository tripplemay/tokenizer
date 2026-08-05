# Transport: same-session bridge

`transport=subagent` does not always mean that the current Coordinator can
launch a child directly. A legacy integration declaration of `"subagent": true`
is Coordinator-native compatibility metadata only: it does not generate a
tool-selectable v2 target. Historical `dispatch/1` host-native descriptors are
still started by the Coordinator with their exact framework persona. Their
internal target is explicitly marked `bridge_id=host-native`, but it is omitted
from the v2 public catalog and cannot be selected by a signed `{tool, invocation}`
binding. An object declaration,
`"subagent": {"bridge":"<id>"}`, resolves only after the catalog validates a
verified manifest at `.claude/dispatch/transports/bridges/<id>.json`.

A future executable bridge inherits the integration's verified `local_cli` adapter,
sandbox, timeout, dedicated HOME, credential allowlist, isolated worktree, and
push prohibition. A future provider invokes the framework-owned
`session-bridge.py`, never a command template from the registry. The durable
run-meta contains only token-shaped root session lineage, a fixed SHA-256 token
derived from the ACP-controlled child-call identifier, and the commissioned
artifact's SHA-256. The raw child-call identifier is used only in memory to
correlate ACP updates; prompts, model text, and raw protocol messages stay out
of Harness artifacts and logs. The generic runner and sandbox both require the
child receipt field to be exactly lower-case SHA-256, so a future driver cannot
silently return a token-shaped raw vendor ID.

## Publication gate

`sandbox-exec` can reduce writes but cannot revoke a same-UID child's inherited
bootstrap/Mach capabilities or constrain its arbitrary HTTPS egress, so it is
defense in depth rather than a strict provider. The framework now includes the
strict `vm-v1` provider implementation, but a Kimi external route remains
absent from a host's public catalog until its installed app and managed project
mirror's required dispatch runtime files agree byte-for-byte and that host produces a fresh provider
attestation. Until then Kimi and Codex remain `local-cli` choices, and a stale
or unproven external target is rejected before a worktree, runtime directory,
or vendor process is created.

An external bridge may be published only by a framework-integrated provider
that freshly attests at both planning and launch. The required contract is in
[`external-bridge-provider.md`](external-bridge-provider.md): VM or
per-task ephemeral principal, copy-in/copy-out workspace, deny-by-default host
filesystem, brokered credentials and egress, provider-owned process lifecycle,
supervisor result pipe, staged executable digest, and nonce-bound attestation.
Provider identity, kind, and canonical contract SHA-256 become part of the
execution provenance. A project registry, PATH entry, adapter command,
environment variable, or device report can never declare that provider.

The Kimi ACP driver is invoked only by the strict provider. Its root
supervisor owns a private receipt pipe, drops the vendor CLI to the dedicated
VM worker identity, reaps the verified bridge process group, and writes the
normalized receipt in a root-only directory; the enclosing systemd job cgroup
owns final containment and reaping of the complete job tree. Copying a raw credential subset to a temporary
directory is not a strict credential boundary, and no release route may rely
on it.

Every execution and authorization entrypoint pins the registry to the invoking
project’s regular, non-symlinked `.agents-registry.json` before it resolves a
target, opens a network connection, creates dispatch state, or starts a
sandbox. `--registry` is therefore an equality assertion, not an authority to
substitute another bridge manifest, adapter command, or endpoint.

Any device report of bridge fields is observability data, not a cryptographic
attestation. A console may describe the locally reported route, but it cannot
authorize an external bridge from report-shaped metadata alone; the project
must freshly resolve the signed `{tool, invocation}` through `tool-catalog.py`
and match its execution provenance before dispatch.

For an active v2 non-fast batch, the selected role also carries an
`execution_provenance_sha256` checkpoint guard. It is recomputed from the
current executable target semantics, including the verified adapter contract,
bridge protocol/strategy, and strict provider identity/kind/contract hash,
before a bridge can run. A changed manifest, adapter command, provider proof,
or target therefore fails closed even when the human-selected `{tool,
invocation}` is unchanged. The human signature still signs only `{tool,
invocation}`; this guard detects runtime drift and is not a cryptographic
attestation of mutable project files. A pre-upgrade five-field active v2 record
must be replanned and consumed before it can execute.

A project manifest cannot publish a driver by setting `_verified: true` on its
own. The catalog accepts only protocol kinds published by this framework
release. Its `protocol.command` must exactly match the integration adapter's
verified `bridge_commands[protocol.kind]`, including the ordinary adapter
executable as the first argument and the ACP subcommand. This stops a manifest
from running an unrelated program with another CLI's scoped credentials.

## Protocol driver

- `acp-native-agent/v1`: establishes an ACP session, sets the documented
  non-interactive mode, asks the root to make exactly one native `Agent` call,
  and verifies the nonce, subagent type, same ACP session, child call ID, child
  terminal update, and root `stopReason=end_turn`.

Kimi's native `plan` Agent is read-only and cannot write the mandatory
schema-checked `planner-proposal` artifact. Therefore the verified Kimi
manifest maps Planner to native `coder`, Generator to `coder`, and Evaluator
to `explore`; this does not change the Harness role contracts. The manifest
alone is not a public route: it still needs the strict provider's fresh plan
and launch proofs. The framework does not publish a Codex bridge on the
strength of `thread/fork`: a fork has a distinct session tree and is not a
same-session subagent.

## Dormant App Server Driver

`app-server-native-agent/v1` is retained as a framework driver for a future
App Server implementation that emits a real native `spawnAgent` lifecycle. It
will fail closed unless it observes exactly one nonce-bearing
`collabAgentToolCall`, a completed child state, and a `thread/read` child whose
`parentThreadId`, shared `sessionId`, and `source.subAgent.thread_spawn` all
point back to the root thread. The installed Codex App Server `0.146.0` did not
emit that lifecycle in isolated probes even with multi-agent capability
enabled, so it has no `_verified: true` manifest and cannot enter the catalog.
The production session-bridge runner intentionally does not load this dormant
driver; only its focused protocol tests may exercise it until an upstream
implementation passes a fresh isolated probe and a framework release publishes
the protocol.

The protocol names are capability-oriented. Once a strict provider is released
and independently attested, a newly supported CLI that conforms to an already
published wire contract needs a matching protocol-validated bridge manifest,
verified adapter `bridge_commands`, verified `local_cli` policy, and an exact
`{tool, protocol}` route in the provider's fresh catalog attestation. This is
the automatic onboarding path; it never needs a per-tool catalog branch, but a
protocol-compatible CLI is deliberately hidden until its provider bundle and
credential driver prove they can execute it. A new wire contract, credential
flow, or provider kind requires a framework driver, protocol tests, negative
isolation tests, and a real isolated lifecycle probe before publication.
