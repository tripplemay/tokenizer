"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * 闸门批准 / 驳回。
 *
 * 批准只是**签发**——服务端用 Ed25519 私钥签名后落库，机器要等 device agent
 * 下次心跳取走、验签、写回本机 progress.json 才真正生效。UI 必须如实反映这个时差，
 * 不能让人误以为按下就已推进。
 */
export function GateActions({ id, disabled, disabledReason }: {
  id: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const t = useTranslations("harness");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function decide(action: "approve" | "reject") {
    if (!window.confirm(t("confirm", { action: t(action) }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/harness/gates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, note: note.trim() || undefined })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{disabledReason}</p>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("notePlaceholder")}
          className="min-w-[180px] flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none dark:border-white/10 dark:bg-navy-900 dark:text-white"
        />
        <button
          type="button"
          disabled={busy || pending}
          onClick={() => decide("approve")}
          className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {t("approve")}
        </button>
        <button
          type="button"
          disabled={busy || pending}
          onClick={() => decide("reject")}
          className="rounded-lg border border-red-400 px-4 py-1.5 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
        >
          {t("reject")}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
