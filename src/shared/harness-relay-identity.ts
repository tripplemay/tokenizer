// Device-driven Harness relay endpoints use headers because GET relays do not
// have a request body. Keep the names shared so the Agent and API cannot drift.
export const HARNESS_RELAY_AGENT_RELEASE_VERSION_HEADER = "x-tokenizer-agent-release-version";
export const HARNESS_RELAY_AGENT_FEATURE_VERSION_HEADER = "x-tokenizer-agent-feature-version";
