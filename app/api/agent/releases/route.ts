import { LATEST_AGENT_RELEASE, normalizeAgentReleaseVersion } from "@/shared/agent-release-version";

export const dynamic = "force-dynamic";

const REPOSITORY = "https://github.com/tripplemay/tokenizer.git";

export async function GET() {
  const commit = "commit" in LATEST_AGENT_RELEASE ? LATEST_AGENT_RELEASE.commit : null;
  if (
    normalizeAgentReleaseVersion(LATEST_AGENT_RELEASE.version) !== LATEST_AGENT_RELEASE.version ||
    typeof commit !== "string" ||
    !/^[0-9a-f]{40}$/.test(commit)
  ) {
    return Response.json({ error: "agent_release_unpinned" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return Response.json({
    schema_version: 1,
    release: {
      version: LATEST_AGENT_RELEASE.version,
      commit,
      repository: REPOSITORY
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
