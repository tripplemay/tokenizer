import { describe, expect, it } from "vitest";
import { LATEST_AGENT_RELEASE } from "@/shared/agent-release-version";
import { GET } from "../../app/api/agent/releases/route";

describe("pinned Agent release endpoint", () => {
  it("serves a fixed release and commit digest without requiring auth", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      schema_version: 1,
      release: {
        version: LATEST_AGENT_RELEASE.version,
        commit: "2074991717abaf3cb34d9aad894bcd4357fefbc3",
        repository: "https://github.com/tripplemay/tokenizer.git"
      }
    });
  });
});
