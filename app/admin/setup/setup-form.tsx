"use client";

import { useState } from "react";

export function SetupForm() {
  const [command, setCommand] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setCommand(null);
    try {
      const response = await fetch("/api/admin/enrollment-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInMinutes: 30 })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "failed to generate install command");
      setCommand(json.installCommand);
      setExpiresAt(json.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={generate}
        disabled={loading}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {loading ? "Generating..." : "Generate Install Command"}
      </button>
      {error ? <div className="mt-3 text-sm text-red-500">{error}</div> : null}
      {command ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-navy-900">
          <div className="text-xs text-gray-500">Expires: {expiresAt ? new Date(expiresAt).toLocaleString() : "unknown"}</div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-sm text-brand-500">{command}</pre>
        </div>
      ) : null}
    </div>
  );
}
