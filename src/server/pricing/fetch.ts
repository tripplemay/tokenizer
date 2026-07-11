// Minimal server-side JSON fetch helpers for the price pipeline. Intentionally
// NOT the client's src/cli/fetch.ts agentFetch — that reads laptop shell/proxy
// env and self-heals for machines behind Clash, which is wrong for the VPS.
// These are plain global fetch with a hard timeout.

export async function fetchJson(url: string, opts?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: opts?.headers });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson(
  url: string,
  body: unknown,
  opts?: { timeoutMs?: number; headers?: Record<string, string> }
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(opts?.headers ?? {}) },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
