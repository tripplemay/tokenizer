import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import type { RequestInit as UndiciRequestInit } from "undici";
import { resolveProxyUrl } from "@/cli/proxy-env";

// Self-healing fetch for the agent. Builds two dispatchers at module load:
// one direct, one tunnelled through HTTPS_PROXY / HTTP_PROXY if either is set
// in the process environment. Each call tries the "preferred" dispatcher
// first and, on failure, transparently retries through the other one — then
// remembers whichever succeeded so subsequent calls go straight to the right
// path. This means the agent self-recovers when the user:
//   * disables their proxy (proxy attempt fails → direct succeeds)
//   * restarts a proxy on the same port the agent was installed against
//     (direct fails → proxy succeeds)
// without needing a `tokenizer install-service` reinstall.
//
// Limitations: if the user moves their proxy to a NEW port the agent was
// never told about, neither cached strategy will work and they still need to
// re-run install-service (or set the new HTTPS_PROXY in shell + restart the
// launchd job). Probing common proxy ports could close that gap; deferred
// until we see it in the wild.

// Resolution order lives in proxy-env: live environment first, then the
// snapshot captured at install time. The snapshot exists because Windows
// Task Scheduler cannot pass environment variables to a task at all.

const directAgent = new Agent({ connect: { timeout: 10_000 } });
const proxyUrl = resolveProxyUrl();
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;

type StrategyName = "direct" | "proxy";
// When the install env carried a proxy, prefer that on first attempt (matches
// the user's manual setup). When it didn't, default to direct.
let preferred: StrategyName = proxyAgent ? "proxy" : "direct";

function orderFor(start: StrategyName): StrategyName[] {
  if (start === "proxy" && proxyAgent) return ["proxy", "direct"];
  return ["direct", "proxy"];
}

function dispatcherFor(name: StrategyName) {
  if (name === "proxy" && proxyAgent) return proxyAgent;
  return directAgent;
}

export async function agentFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown;
  for (const strategy of orderFor(preferred)) {
    if (strategy === "proxy" && !proxyAgent) continue;
    try {
      const response = await undiciFetch(url, {
        ...(init as UndiciRequestInit),
        dispatcher: dispatcherFor(strategy)
      });
      // Stick with whichever strategy succeeded so the next call doesn't
      // pay the retry cost.
      preferred = strategy;
      return response as unknown as Response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("fetch failed (no strategies available)");
}

// Exposed for diagnostics / status.
export function fetchStrategyState() {
  return {
    proxyAvailable: Boolean(proxyAgent),
    proxyUrl,
    preferred
  };
}
