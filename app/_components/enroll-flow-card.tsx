"use client";

import { useEffect, useRef, useState } from "react";
import { MdContentCopy, MdCheckCircle, MdAccessTime, MdRefresh } from "react-icons/md";

type Mode = "idle" | "generating" | "waiting" | "success" | "error";

type ResponseDevice = { deviceId: string; name: string };

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_MS = 10 * 60 * 1000; // stop polling after 10 minutes — token also expires before then

// Self-contained enrollment flow: click "生成命令" → server returns a one-time
// curl line → component starts polling /api/devices to detect when the new
// machine actually appears. Drops into a success card once the new device
// arrives so the user gets unambiguous confirmation that their install
// worked, without needing to refresh the page.
export function EnrollFlowCard({
  initialDeviceIds,
  onSuccess
}: {
  initialDeviceIds: string[];
  onSuccess?: (device: ResponseDevice) => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [command, setCommand] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newDevice, setNewDevice] = useState<ResponseDevice | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const initialIdsRef = useRef<Set<string>>(new Set(initialDeviceIds));

  async function generate() {
    setMode("generating");
    setError(null);
    setCommand(null);
    setNewDevice(null);
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
      setMode("waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode("error");
    }
  }

  async function copyCommand() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* clipboard may be unavailable on http or older browsers */
    }
  }

  // Poll /api/devices while we're waiting. Stops on success or after
  // POLL_MAX_MS. Snapshot of "old" device ids comes from initialIdsRef so we
  // don't false-trigger on devices that existed before the user clicked.
  useEffect(() => {
    if (mode !== "waiting") return;
    let cancelled = false;
    const start = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await fetch("/api/devices", { cache: "no-store" });
        if (!r.ok) return;
        const { devices } = (await r.json()) as { devices: ResponseDevice[] };
        const fresh = devices.find((d) => !initialIdsRef.current.has(d.deviceId));
        if (fresh) {
          setNewDevice(fresh);
          setMode("success");
          onSuccess?.(fresh);
          return;
        }
      } catch {
        /* transient network blip — keep polling */
      }
      if (Date.now() - start > POLL_MAX_MS) {
        if (!cancelled) {
          setError("超时,未检测到新设备。请确认终端命令已成功运行,或重新生成命令。");
          setMode("error");
        }
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [mode, onSuccess]);

  // Show a live countdown for the token-expires hint
  useEffect(() => {
    if (mode !== "waiting" || !expiresAt) return;
    const expiry = new Date(expiresAt).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [mode, expiresAt]);

  if (mode === "success" && newDevice) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 dark:border-emerald-400/30 dark:bg-emerald-500/10">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-emerald-500/15 p-2 text-emerald-600 dark:text-emerald-300">
            <MdCheckCircle className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-bold text-emerald-700 dark:text-emerald-300">已连接:{newDevice.name}</h3>
            <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-200/70">
              客户端在线。首次同步需要 60-90 秒,数据会自动出现在 dashboard 上。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  initialIdsRef.current.add(newDevice.deviceId);
                  setMode("idle");
                  setCommand(null);
                  setNewDevice(null);
                  setError(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-400/30 dark:bg-navy-800 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
              >
                <MdRefresh className="h-3.5 w-3.5" />
                继续添加另一台
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {mode === "idle" || mode === "error" ? (
        <button
          onClick={generate}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 active:scale-[0.99]"
        >
          生成安装命令
        </button>
      ) : null}
      {mode === "generating" ? (
        <button disabled className="inline-flex items-center gap-2 rounded-xl bg-brand-500/60 px-4 py-2.5 text-sm font-semibold text-white">
          正在生成...
        </button>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {command && (mode === "waiting" || mode === "error") ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-navy-900/60">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <MdAccessTime className="h-3.5 w-3.5" />
                <span>
                  有效期 {secondsLeft != null ? formatSeconds(secondsLeft) : "30 分钟"} {secondsLeft != null && secondsLeft <= 0 ? "(已过期,请重新生成)" : ""}
                </span>
              </div>
              <button
                onClick={copyCommand}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-navy-800 dark:text-gray-200 dark:hover:bg-white/5"
              >
                {copied ? <MdCheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <MdContentCopy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm text-brand-500 dark:text-brand-300">{command}</pre>
          </div>
          {mode === "waiting" ? (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              <span>等待客户端首次上线... 一旦连接成功这里会自动显示。</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatSeconds(s: number): string {
  if (s <= 0) return "0 秒";
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m > 0) return `${m} 分 ${r} 秒`;
  return `${r} 秒`;
}
