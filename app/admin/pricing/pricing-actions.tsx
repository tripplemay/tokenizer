"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Price = { input: number | null; cacheRead: number | null; cacheWrite: number | null; output: number | null };

async function postReview(payload: Record<string, unknown>) {
  const res = await fetch("/api/admin/pricing/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

const PRICE_FIELDS = ["input", "cacheRead", "cacheWrite", "output"] as const;

export function PricingRowActions({ modelKey, status, price }: { modelKey: string; status: string; price: Price }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<(typeof PRICE_FIELDS)[number], string>>({
    input: price.input?.toString() ?? "",
    cacheRead: price.cacheRead?.toString() ?? "",
    cacheWrite: price.cacheWrite?.toString() ?? "",
    output: price.output?.toString() ?? ""
  });

  const run = (payload: Record<string, unknown>) => {
    setError(null);
    start(async () => {
      try {
        await postReview(payload);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const numOrUndef = (value: string) => (value.trim() === "" ? undefined : Number(value));
  const canApprove = status !== "approved" && (status === "pending_review" || price.input != null);

  return (
    <div className="flex flex-col items-end gap-1">
      {editing ? (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {PRICE_FIELDS.map((field) => (
            <input
              key={field}
              value={form[field]}
              onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
              placeholder={field}
              inputMode="decimal"
              className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-white/20 dark:bg-navy-800 dark:text-white"
            />
          ))}
          <button
            disabled={pending}
            onClick={() =>
              run({
                modelKey,
                action: "edit",
                price: {
                  input: numOrUndef(form.input),
                  cacheRead: numOrUndef(form.cacheRead),
                  cacheWrite: numOrUndef(form.cacheWrite),
                  output: numOrUndef(form.output)
                }
              })
            }
            className="rounded bg-brand-500 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
          <button
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="px-2 py-0.5 text-xs text-gray-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {canApprove ? (
            <button
              disabled={pending}
              onClick={() => run({ modelKey, action: "approve" })}
              className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
          ) : null}
          <button
            disabled={pending}
            onClick={() => setEditing(true)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-navy-700 dark:border-white/20 dark:text-white"
          >
            Edit
          </button>
          {status !== "rejected" ? (
            <button
              disabled={pending}
              onClick={() => run({ modelKey, action: "reject" })}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-red-600 dark:border-white/20"
            >
              Reject
            </button>
          ) : null}
          <button
            disabled={pending}
            onClick={() => run({ modelKey, action: "relookup" })}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 dark:border-white/20 dark:text-gray-300"
          >
            Re-lookup
          </button>
        </div>
      )}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

export function ScanButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const scan = () => {
    setMessage(null);
    start(async () => {
      const res = await fetch("/api/admin/pricing/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false })
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; summary?: { toDetect?: number; toAutoFree?: number } };
      if (res.ok) {
        setMessage(`detected ${body.summary?.toDetect ?? 0}, free ${body.summary?.toAutoFree ?? 0}`);
        router.refresh();
      } else {
        setMessage(body.error ?? `HTTP ${res.status}`);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {message ? <span className="text-xs text-gray-500">{message}</span> : null}
      <button
        disabled={pending}
        onClick={scan}
        className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Scanning…" : "Scan now"}
      </button>
    </div>
  );
}
