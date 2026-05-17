"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function LoginForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const t = useTranslations("admin.login");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      router.push("/admin/setup");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="password"
        autoFocus
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={t("placeholder")}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-navy-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-navy-900 dark:text-white"
      />
      <button
        type="submit"
        disabled={loading || !token}
        className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {loading ? t("submitting") : t("submit")}
      </button>
      {error ? <div className="text-sm text-red-500">{error}</div> : null}
    </form>
  );
}
