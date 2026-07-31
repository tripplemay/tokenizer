// Numeric agent capability version, baked into the build at release time.
// The agent sends AGENT_FEATURE_VERSION in every heartbeat; the server
// compares it against compatibility thresholds for capability-gated behavior.
// Strict "latest Agent release" checks use src/shared/agent-release-version.ts
// instead, because a capability level cannot identify a particular release.
//
// Why a number (not a git SHA): the server can't order SHAs without the
// repo, and maintaining a hand-curated "acceptable SHAs" set every release
// is fragile — the very commit that adds a SHA isn't in the set yet, so
// devices ride a perpetual one-release lag. A monotonically-increasing
// integer makes the comparison trivial and lets the cadence of bumps be
// decoupled from the cadence of commits.
//
// Bump in lockstep on both constants when shipping a release that should
// prompt users to upgrade (new must-have parser fields, new diagnostic
// capabilities, schema-affecting heartbeat changes). For pure bug fixes
// where stragglers are acceptable, leave them alone.
//
// History:
//   1 — 2026-05-19: initial cutover from SHA-based gating
//   2 — 2026-07-03: claude parser v2 (streamed-usage undercount fix + model
//       fallback attribution); old agents keep uploading first-row snapshots
//       that the corrected data would fight with, so prompt an upgrade.
//   3 — 2026-07-26: harness orchestration reporting + signed gate relay +
//       mode fingerprint. Prompting is not cosmetic here: on an agent below
//       3 the console has nothing that pulls signed decisions down, so a
//       human approval made on /harness never reaches the machine — the gate
//       just sits there. Mode badges likewise render "not reported yet".
//   4 — 2026-07-27: signed mode-intent staging/ACK, pending defaults and agent
//       capability snapshots, plus bounded dispatch run summaries. Older
//       agents cannot safely receive mode changes and leave detail views stale.
//   5 — 2026-07-30: bounded Harness sync health in local state and heartbeat.
//       Older agents cannot report whether orchestration transport is healthy.
//   6 — 2026-07-31: tool-bound Harness mode intents and the reported tool
//       capability catalog. Older agents can still consume v1 intents, but
//       cannot safely issue or stage the v2 tool-binding contract.
//   7 — 2026-07-31: tool-catalog report compatibility and upgrade visibility.
//       A compatibility branch lets capability-6 agents recover their report,
//       but this release is required before they can be treated as current or
//       issue tool-bound intents.
export const AGENT_FEATURE_VERSION = 7;
export const MIN_AGENT_FEATURE_VERSION = 7;

// Signed Harness mode intent issuance was added at capability level 4. Keep
// this separate from the global update threshold so the API and UI never drift.
export const MIN_MODE_INTENT_AGENT_FEATURE_VERSION = 4;

// Tool-bound mode intents are deliberately gated separately from the v1
// agent-id contract so previously issued v1 intents remain readable and
// consumable during the rollout.
export const MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION = 7;

/** The capability level to show for a mode-intent compatibility blocker. */
export function requiredModeIntentAgentFeatureVersion(blocker: string | null | undefined): number {
  return blocker === "toolBindingAgentUpgradeRequired"
    ? MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
    : MIN_MODE_INTENT_AGENT_FEATURE_VERSION;
}

// The ingest correction pass (updating an existing UsageEvent row in place
// when a re-parse revises it) is only trusted from agents at or above this
// version: older agents upload first-row placeholder snapshots that would
// regress corrected rows.
export const PARSER_CORRECTION_FEATURE_VERSION = 2;
