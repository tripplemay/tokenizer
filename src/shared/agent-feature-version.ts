// Numeric agent capability version, baked into the build at release time.
// The agent sends AGENT_FEATURE_VERSION in every heartbeat; the server
// compares it against MIN_AGENT_FEATURE_VERSION to decide whether to flag
// the device as outdated on the dashboard.
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
export const AGENT_FEATURE_VERSION = 1;
export const MIN_AGENT_FEATURE_VERSION = 1;
