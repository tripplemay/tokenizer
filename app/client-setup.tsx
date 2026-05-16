"use client";

import { useState } from "react";

export function ClientSetup() {
  const [adminToken, setAdminToken] = useState("");
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
        headers: { "content-type": "application/json", "x-admin-token": adminToken },
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
    <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
      <h2 className="text-xl font-semibold">Client Setup</h2>
      <p className="mt-1 text-sm text-slate-500">Generate a one-time install command. The installer detects the client name and lets you edit it.</p>
      <div className="mt-4 flex flex-col gap-3 md:flex-row">
        <input className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" type="password" placeholder="Admin token" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
        <button className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60" onClick={generate} disabled={loading || !adminToken}>{loading ? "Generating..." : "Generate Install Command"}</button>
      </div>
      {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}
      {command ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs text-slate-500">Expires: {expiresAt ? new Date(expiresAt).toLocaleString() : "unknown"}</div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-sm text-cyan-100">{command}</pre>
        </div>
      ) : null}
    </section>
  );
}
