import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentFetch: vi.fn(),
  writeCredentials: vi.fn()
}));

vi.mock("../../src/cli/fetch", () => ({ agentFetch: mocks.agentFetch }));
vi.mock("../../src/cli/config", () => ({
  configure: vi.fn(),
  ensureDevice: vi.fn(),
  readConfig: vi.fn(() => ({ serverUrl: "https://token.example.test/" })),
  readDevice: vi.fn(() => ({ id: "dev-1", metadata: {} })),
  writeCredentials: mocks.writeCredentials,
  writeDevice: vi.fn()
}));

import { enrollDevice } from "../../src/cli/enroll";

describe("enrollDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enrolls through the self-healing agentFetch and stores the device token", async () => {
    mocks.agentFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ deviceToken: "tok-123" })
    });
    await enrollDevice({ enrollToken: "enroll-1", deviceName: "Dev", yes: true });
    expect(mocks.agentFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.agentFetch.mock.calls[0];
    expect(url).toBe("https://token.example.test/api/devices/enroll");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.enrollToken).toBe("enroll-1");
    expect(body.device.name).toBe("Dev");
    expect(mocks.writeCredentials).toHaveBeenCalledWith({ deviceToken: "tok-123" });
  });

  it("throws on a non-2xx response and never writes credentials", async () => {
    mocks.agentFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "bad token"
    });
    await expect(enrollDevice({ enrollToken: "nope", deviceName: "Dev", yes: true })).rejects.toThrow(
      "Enroll failed: 403"
    );
    expect(mocks.writeCredentials).not.toHaveBeenCalled();
  });
});
