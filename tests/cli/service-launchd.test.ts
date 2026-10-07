import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLaunchdIdentity } from "@/cli/service";

describe("launchd service identity", () => {
  it("uses the production label unless an isolated test identity is explicitly enabled", () => {
    const home = join(tmpdir(), "tokenizer-production-home");
    expect(resolveLaunchdIdentity(home, {})).toEqual({
      label: "cc.tokenizer.agent",
      plist: join(home, "Library", "LaunchAgents", "cc.tokenizer.agent.plist")
    });
  });

  it("allows a unique CI label only under a temporary HOME", () => {
    const home = join(tmpdir(), "tokenizer-launchd-fixture-home");
    const label = "cc.tokenizer.agent.ci.1234.abcd";
    expect(resolveLaunchdIdentity(home, {
      TOKENIZER_LAUNCHD_TEST_MODE: "1",
      TOKENIZER_LAUNCHD_TEST_LABEL: label
    })).toEqual({ label, plist: join(home, "Library", "LaunchAgents", `${label}.plist`) });
  });

  it.each([
    [{ TOKENIZER_LAUNCHD_TEST_LABEL: "cc.tokenizer.agent.ci.1234" }, "requires TOKENIZER_LAUNCHD_TEST_MODE=1"],
    [{ TOKENIZER_LAUNCHD_TEST_MODE: "1", TOKENIZER_LAUNCHD_TEST_LABEL: "cc.tokenizer.agent" }, "Invalid isolated launchd test label"],
    [{ TOKENIZER_LAUNCHD_TEST_MODE: "1", TOKENIZER_LAUNCHD_TEST_LABEL: "cc.tokenizer.agent.ci.bad/value" }, "Invalid isolated launchd test label"]
  ])("rejects unsafe test identity %#", (env, message) => {
    expect(() => resolveLaunchdIdentity(join(tmpdir(), "tokenizer-test"), env)).toThrow(message);
  });

  it("rejects an isolated label under the real user HOME", () => {
    expect(() => resolveLaunchdIdentity(homedir(), {
      TOKENIZER_LAUNCHD_TEST_MODE: "1",
      TOKENIZER_LAUNCHD_TEST_LABEL: "cc.tokenizer.agent.ci.real-home"
    })).toThrow("inside the OS temporary directory");
  });
});
