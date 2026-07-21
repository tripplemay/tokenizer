import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureProxyEnv, loadProxyEnv, resolveProxyUrl } from "@/cli/proxy-env";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tokenizer-proxy-"));
  file = join(dir, "proxy.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("captureProxyEnv", () => {
  it("captures only the proxy keys that are set", () => {
    expect(captureProxyEnv({ HTTPS_PROXY: "http://p:1", PATH: "/usr/bin" })).toEqual({ HTTPS_PROXY: "http://p:1" });
  });

  it("ignores empty values", () => {
    expect(captureProxyEnv({ HTTPS_PROXY: "" })).toEqual({});
  });
});

describe("loadProxyEnv", () => {
  it("returns an empty object when the file is absent", () => {
    expect(loadProxyEnv(file)).toEqual({});
  });

  it("returns an empty object for a corrupt file rather than throwing", () => {
    writeFileSync(file, "{ not json");
    expect(loadProxyEnv(file)).toEqual({});
  });

  it("drops non-string values", () => {
    writeFileSync(file, JSON.stringify({ HTTPS_PROXY: "http://p:1", HTTP_PROXY: 5 }));
    expect(loadProxyEnv(file)).toEqual({ HTTPS_PROXY: "http://p:1" });
  });
});

describe("resolveProxyUrl", () => {
  it("prefers the live environment over the saved snapshot", () => {
    // A user who changes proxies in their shell must not be overridden by
    // whatever was captured at install time.
    writeFileSync(file, JSON.stringify({ HTTPS_PROXY: "http://stale:1" }));
    expect(resolveProxyUrl({ HTTPS_PROXY: "http://live:2" }, file)).toBe("http://live:2");
  });

  it("falls back to the snapshot when the environment has none", () => {
    // This is the Task Scheduler case: the task inherits an environment that
    // never sourced the user's shell profile.
    writeFileSync(file, JSON.stringify({ HTTPS_PROXY: "http://saved:1" }));
    expect(resolveProxyUrl({}, file)).toBe("http://saved:1");
  });

  it("returns null when neither source has a proxy", () => {
    expect(resolveProxyUrl({}, file)).toBeNull();
  });

  it("prefers HTTPS_PROXY over HTTP_PROXY", () => {
    expect(resolveProxyUrl({ HTTP_PROXY: "http://a:1", HTTPS_PROXY: "http://b:2" }, file)).toBe("http://b:2");
  });
});
