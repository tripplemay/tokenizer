"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function SetupForm() {
  // Same reasoning as the enroll flow card: a Windows machine must not be
  // handed a curl-to-bash line.
  const [commands, setCommands] = useState<{ id: string; label: string; command: string }[]>([]);
  const [platform, setPlatform] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const t = useTranslations("admin.setup");

  async function generate() {
    setLoading(true);
    setError(null);
    setCommands([]);
    try {
      const response = await fetch("/api/admin/enrollment-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInMinutes: 30 })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "failed to generate install command");
      setCommands(
        json.installCommands ?? [{ id: "posix", label: "macOS / Linux", command: json.installCommand }]
      );
      setExpiresAt(json.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const activeCommand = commands.find((entry) => entry.id === platform) ?? commands[0] ?? null;

  return (
    <div>
      <button
        onClick={generate}
        disabled={loading}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {loading ? t("generating") : t("generate")}
      </button>
      {error ? <div className="mt-3 text-sm text-red-500">{error}</div> : null}
      {activeCommand ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-navy-900">
          <div className="text-xs text-gray-500">{t("expires", { time: expiresAt ? new Date(expiresAt).toLocaleString() : t("expiresUnknown") })}</div>
          <div className="mt-2 flex items-center gap-1">
            {commands.length > 1
              ? commands.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setPlatform(entry.id)}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      entry.id === activeCommand.id
                        ? "bg-gray-200 text-navy-700 dark:bg-white/10 dark:text-gray-100"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))
              : null}
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-sm text-brand-500">{activeCommand.command}</pre>
        </div>
      ) : null}
    </div>
  );
}
