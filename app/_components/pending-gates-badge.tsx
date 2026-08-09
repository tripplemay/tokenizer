"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** 与 /harness 页 AutoRefresh 同拍（BL-GATE-INBOX F001，测试断言此常量） */
export const PENDING_GATES_POLL_MS = 30_000;

/** 徽章渲染判定：n>0 才渲染；加载失败按 0 处理（fail-quiet，不打扰导航） */
export function shouldRenderPendingBadge(pending: number | null): pending is number {
  return typeof pending === "number" && pending > 0;
}

export function PendingGatesBadge() {
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/harness/gates/pending-count", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { pending?: unknown };
        if (active) setPending(typeof body.pending === "number" ? body.pending : null);
      } catch {
        if (active) setPending(null);
      }
    };
    void load();
    const timer = setInterval(load, PENDING_GATES_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!shouldRenderPendingBadge(pending)) return null;
  return (
    <Link
      href="/harness"
      aria-label={`${pending} pending gate approvals`}
      className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      {pending > 99 ? "99+" : pending}
    </Link>
  );
}
