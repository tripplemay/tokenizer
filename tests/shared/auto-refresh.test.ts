import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanup: undefined as undefined | (() => void),
  listeners: new Map<string, Set<() => void>>(),
  pending: false,
  refresh: vi.fn(),
  startTransition: vi.fn((callback: () => void) => callback())
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      mocks.cleanup?.();
      const cleanup = effect();
      mocks.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    },
    useTransition: () => [mocks.pending, mocks.startTransition] as const
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { AutoRefresh } from "../../app/_components/auto-refresh";

describe("AutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.cleanup = undefined;
    mocks.listeners.clear();
    mocks.pending = false;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        visibilityState: "visible",
        addEventListener: vi.fn((type: string, listener: () => void) => {
          const listeners = mocks.listeners.get(type) ?? new Set();
          listeners.add(listener);
          mocks.listeners.set(type, listeners);
        }),
        removeEventListener: vi.fn((type: string, listener: () => void) => {
          mocks.listeners.get(type)?.delete(listener);
        })
      }
    });
  });

  afterEach(() => {
    mocks.cleanup?.();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "document");
  });

  it("does not enqueue another refresh while the previous transition is pending", () => {
    AutoRefresh({ intervalMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();

    mocks.pending = true;
    AutoRefresh({ intervalMs: 1_000 });
    vi.advanceTimersByTime(5_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();

    mocks.pending = false;
    AutoRefresh({ intervalMs: 1_000 });
    vi.advanceTimersByTime(999);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses while hidden and refreshes immediately when visible again", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    AutoRefresh({ intervalMs: 1_000 });

    vi.advanceTimersByTime(5_000);
    expect(mocks.refresh).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    for (const listener of mocks.listeners.get("visibilitychange") ?? []) listener();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("clears the timer and visibility listener on unmount", () => {
    AutoRefresh({ intervalMs: 1_000 });
    const listener = [...(mocks.listeners.get("visibilitychange") ?? [])][0];

    mocks.cleanup?.();
    vi.advanceTimersByTime(5_000);

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(document.removeEventListener).toHaveBeenCalledWith("visibilitychange", listener);
    expect(mocks.listeners.get("visibilitychange")).toEqual(new Set());
  });
});
