import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  enrolledDevice: vi.fn(),
  devices: vi.fn()
}));

vi.mock("@/server/auth-session", () => ({ requireSession: async () => ({ user: { id: "tenant-1" } }) }));
vi.mock("@/server/timezone", () => ({ getUserTimezone: async () => "Asia/Jakarta" }));
vi.mock("@/server/db", () => ({ prisma: { device: { findFirst: mocks.enrolledDevice, findMany: mocks.devices } } }));
vi.mock("@/server/summaries", () => ({
  getSummary: mocks.summary,
  getBreakdown: vi.fn(),
  getDailyCost: vi.fn(),
  getDailyBySource: vi.fn(),
  getDailySummary: vi.fn(),
  getDeviceSummary: vi.fn(),
  getProjectSummary: vi.fn()
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(":")}` : key
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/widget/Widget", () => ({ default: () => null }));

import HomePage from "../../app/page";
import { AutoRefresh } from "../../app/_components/auto-refresh";
import { OnboardingCard } from "../../app/_components/onboarding-card";
import { PageBanner } from "../../app/_components/page-banner";
import { RangeSelector } from "../../app/_components/range-selector";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

function childrenOf(element: React.ReactElement): React.ReactElement<Record<string, unknown>>[] {
  const props = element.props as { children: React.ReactNode };
  return React.Children.toArray(props.children) as React.ReactElement<Record<string, unknown>>[];
}

describe("home first-use state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enrolledDevice.mockResolvedValue(null);
    mocks.devices.mockResolvedValue([]);
  });

  it("keeps visible-only refresh mounted while a new user waits for first usage", async () => {
    mocks.summary.mockResolvedValue({ eventCount: 0, lastEventAt: null });

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const children = childrenOf(page);

    expect(children[0].type).toBe(AutoRefresh);
    expect(children[1].type).toBe(OnboardingCard);
    expect(children[1].props.deviceName).toBeNull();
    expect(mocks.enrolledDevice).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "tenant-1" } }));
  });

  it("shows enrolled-awaiting-sync separately from a user who has not connected a device", async () => {
    mocks.summary.mockResolvedValue({ eventCount: 0, lastEventAt: null });
    mocks.enrolledDevice.mockResolvedValue({ name: "Dev Mac" });

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const children = childrenOf(page);

    expect(children[0].type).toBe(AutoRefresh);
    expect(children[1].type).toBe(OnboardingCard);
    expect(children[1].props.deviceName).toBe("Dev Mac");
    expect((children[1].props.labels as { waitingTitle: string }).waitingTitle).toContain("Dev Mac");
    const html = renderToStaticMarkup(children[1]);
    expect(html).toContain("Dev Mac");
    expect(html).toContain("home.onboarding.devicesLink");
    expect(html).not.toContain("生成安装命令");
  });

  it("keeps range selection and refresh for a historical user with an empty 7d window", async () => {
    mocks.summary.mockResolvedValue({ eventCount: 0, lastEventAt: "2026-08-01T00:00:00.000Z" });

    const page = await HomePage({ searchParams: Promise.resolve({ range: "7d", gitOnly: "1" }) });
    const children = childrenOf(page);

    expect(children[0].type).toBe(AutoRefresh);
    expect(children[1].type).toBe(PageBanner);
    const selector = children[1].props.rightSlot as React.ReactElement<{ current: string; searchParams: Record<string, string> }>;
    expect(selector.type).toBe(RangeSelector);
    expect(selector.props.current).toBe("7d");
    expect(selector.props.searchParams.gitOnly).toBe("1");
    expect(children.some((child) => child.type === OnboardingCard)).toBe(false);
    expect(mocks.enrolledDevice).not.toHaveBeenCalled();

    mocks.devices.mockResolvedValue([{ id: "dev-1", name: "Old Mac", lastSeenAt: new Date() }]);
    const suspenseChild = (children[3].props.children as React.ReactElement<Record<string, unknown>>);
    const section = await (suspenseChild.type as (props: { tenantId: string }) => Promise<React.ReactElement | null>)(
      suspenseChild.props as { tenantId: string }
    );
    expect(section).not.toBeNull();
    const html = renderToStaticMarkup(section);
    expect(html).toContain("Old Mac");
    expect(html).toContain("/devices/dev-1");
    expect(html).toContain("clientStatus.online");
    expect(mocks.devices).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "tenant-1" },
      take: 5,
      select: { id: true, name: true, lastSeenAt: true }
    }));
  });

  it("switches to the dashboard after the cached empty summary catches up", async () => {
    mocks.summary
      .mockResolvedValueOnce({ eventCount: 0, lastEventAt: null })
      .mockResolvedValueOnce({ eventCount: 1, lastEventAt: "2026-10-07T00:00:00.000Z" });

    const first = await HomePage({ searchParams: Promise.resolve({}) });
    const next = await HomePage({ searchParams: Promise.resolve({}) });

    expect(childrenOf(first).some((child) => child.type === OnboardingCard)).toBe(true);
    expect(childrenOf(next)[0].type).toBe(AutoRefresh);
    expect(childrenOf(next).some((child) => child.type === OnboardingCard)).toBe(false);
    expect(mocks.enrolledDevice).toHaveBeenCalledTimes(1);
  });
});
