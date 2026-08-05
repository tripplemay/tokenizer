# Strict External Bridge Provider

External same-session subagents are unavailable unless the framework owns a
provider that proves this contract at both catalog resolution and launch. A
project registry, adapter, environment variable, device report, or PATH entry
is never a provider discovery mechanism.

The provider returns a nonce-bound attestation conforming to
`external-bridge-provider.schema.json`. Its canonical contract SHA-256, stable
provider id, and kind enter the resolved target and
`execution_provenance_sha256`; any change requires a new plan.

Catalog attestations remain valid for 300 seconds so discovery stays fresh. A
launch attestation is issued only after private copy-in completes and has a
390-second bounded lifetime for the maximum worker turn, copy-out, one broker
request, and return-validation margin. A completed, in-budget worker is not
rejected solely because its preparation occurred before the launch proof.

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

## Published `vm-v1` Runtime

The current provider is `harness-vm-v1`. It accepts only a fixed plain Lima
VZ instance named `harness-vm-v1`: no project mount, host proxy propagation,
port forwarding, additional network attachment, container runtime, SSH agent
forwarding, or guest filesystem transport is accepted. The provider validates
that runtime on every attestation and launch, including the live guest mount
table.

Its private configuration is account-scoped under
`~/.tokenizer/harness/vm-v1/`; it records SHA-256 bindings for the Lima
executable/profile/base image, the staged CLI bundle, and the broker policy.
The provider derives this path from the effective account, not `HOME`. Missing
configuration, stale hashes, an unavailable VM, or a broker failure simply
withholds the external bridge from the catalog.

The broker reads the configured host credential only into its process memory,
hands the guest a per-run lease, and proxies only to the configured HTTPS
origin. The guest firewall permits its job only to that short-lived broker;
the worker receives neither raw credential material nor a mounted user CLI
state directory. These local files are installation state, never project
configuration or source-controlled artifacts. A credential must have enough
remaining lifetime for the provider's bounded vendor turn, copy-out, in-flight
upstream request, and shutdown margin; a token close to expiry withholds the
route before any guest egress is opened.

Lima itself derives the profile lookup location from `HOME`. Its host command
therefore receives only the effective account's passwd-derived `HOME`, plus
the provider's fixed PATH and locale; it never inherits the Coordinator's or
caller's environment. This host-side setting does not enter the guest process
environment or relax the no-host-input contract.

For the published Kimi ACP bridge, the root supervisor invokes the pinned,
non-symlink `/usr/bin/setpriv` inside the guest before the vendor executable.
The transition fixes the `harnessvm` uid/gid, clears supplementary groups,
clears inheritable and ambient capabilities, and sets `NoNewPrivs`. The vendor
child is then required to show zero `CapInh`, `CapPrm`, `CapEff`, and `CapAmb`
values plus `NoNewPrivs=1`; its capability bounding set is not itself an
authority grant. A source-only L2 probe performs that no-network check under
the same root-supervisor systemd profile before it opens a credential broker
lease. Missing, replaced, or non-executable `setpriv` fails provider readiness.

## Automatic CLI Admission

After one provider kind is released, a new CLI using an already published wire
protocol (currently `acp-native-agent/v1`) joins automatically when its
verified adapter and bridge manifest match an exact `{tool, protocol}` record
in that provider's fresh catalog attestation. The record proves that the
installed bundle and credential driver can actually execute that CLI; protocol
compatibility alone is not sufficient. The current `vm-v1` provider publishes
only Kimi ACP. A new wire protocol, credential transport, provider bundle, or
provider kind still requires a framework driver, negative isolation tests, and
an independent real-provider probe before it can be published.
