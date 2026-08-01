# Strict External Bridge Provider

External same-session subagents are unavailable unless the framework owns a
provider that proves this contract at both catalog resolution and launch. A
project registry, adapter, environment variable, device report, or PATH entry
is never a provider discovery mechanism.

The provider returns a nonce-bound attestation conforming to
`external-bridge-provider.schema.json`. Its canonical contract SHA-256, stable
provider id, and kind enter the resolved target and
`execution_provenance_sha256`; any change requires a new plan.

Required guarantees:

- `provider_kind` is `vm-v1` or `ephemeral-uid-v1`; the worker cannot run as
  the Coordinator's principal.
- The repository, runner, and staged CLI bundle are copied into the worker;
  no Coordinator checkout, `.git`, HOME, socket, or durable dispatch state is
  mounted or inherited.
- The staged worker/CLI identity is bound by a framework-verified SHA-256 or
  equivalent signed image digest, not by PATH or a project manifest.
- Credentials and network egress are brokered by the provider. The vendor
  process receives neither a raw host credential nor arbitrary direct network
  access.
- The provider starts, observes, and reaps the complete worker job tree. A
  child cannot escape with `setsid`, parent exit, or a detached helper.
- Results return only through a supervisor-owned pipe. The provider verifies
  the commissioned artifact, anti-symlink rules, nonce-bound same-session
  proof, and non-reversible child receipt before copying output back.

`sandbox-exec`, `env -i`, a dedicated HOME, a CWD convention, and a temporary
credential copy may be additional defenses, but none qualifies as this
provider on its own.

## Automatic CLI Admission

After one provider kind is released, a new CLI using an already published wire
protocol (currently `acp-native-agent/v1`) joins automatically when its
verified adapter and bridge manifest match the protocol and declare supported
personas. A new wire protocol, credential transport, or provider kind still
requires a framework driver, negative isolation tests, and an independent
real-provider probe before it can be published.
