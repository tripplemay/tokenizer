import Link from "next/link";
import { MdArrowBack, MdPriceCheck } from "react-icons/md";
import Card from "@/components/card";
import { requireAdmin } from "@/server/auth-session";
import { getPricingQueue, type PricingQueueRow } from "@/server/pricing/queue";
import { isAutoPricingEnabled } from "@/server/pricing/trigger";
import { formatTokens, formatUsd } from "@/shared/format";
import { PricingRowActions, ScanButton } from "./pricing-actions";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  pending_review: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300",
  detected: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  auto_applied: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  ignored: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  rejected: "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{status}</span>;
}

function priceCell(row: PricingQueueRow) {
  if (row.input == null || row.output == null) return <span className="text-gray-400">—</span>;
  return (
    <span className="whitespace-nowrap font-medium text-navy-700 dark:text-white">
      {formatUsd(row.input)} <span className="text-gray-400">/</span> {formatUsd(row.output)}
    </span>
  );
}

export default async function PricingAdminPage() {
  await requireAdmin();
  const { rows, counts } = await getPricingQueue();
  const autoEnabled = isAutoPricingEnabled();
  const actionable = (counts["pending_review"] ?? 0) + (counts["detected"] ?? 0) + (counts["failed"] ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
            <MdArrowBack className="h-4 w-4" /> Back
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-navy-700 dark:text-white">
            <MdPriceCheck className="h-6 w-6 text-brand-500" /> Model pricing
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {rows.length} tracked · {actionable} awaiting action · auto-lookup{" "}
            <span className={autoEnabled ? "text-green-600" : "text-gray-500"}>{autoEnabled ? "on" : "off"}</span>
          </p>
        </div>
        <ScanButton />
      </div>

      {!autoEnabled ? (
        <Card extra="p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Auto-lookup is disabled (<code className="font-mono text-xs">PRICING_AUTO_ENABLED</code> unset). New models are still
            detected and queued here; set a price with <span className="font-medium">Edit → Save</span> to make it take effect
            immediately (no redeploy). Enable the env flag to have LiteLLM / OpenRouter pre-fill candidate prices.
          </p>
        </Card>
      ) : null}

      <Card extra="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-500 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Billable tokens</th>
                <th className="px-4 py-3 text-right">Price in / out (/Mtok)</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No models tracked yet. Click <span className="font-medium">Scan now</span> to discover unpriced models from
                    existing usage.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="px-4 py-3">
                      <Link href={`/models/${encodeURIComponent(row.modelKey)}`} className="font-mono font-medium hover:underline">
                        {row.modelKey}
                      </Link>
                      {row.notes ? <div className="text-xs text-gray-400">{row.notes}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-right">{formatTokens(row.billableTokens)}</td>
                    <td className="px-4 py-3 text-right">{priceCell(row)}</td>
                    <td className="px-4 py-3">
                      {row.sourceUrl ? (
                        <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">
                          {row.source ?? "source"}
                        </a>
                      ) : (
                        <span className="text-gray-500">{row.source ?? "—"}</span>
                      )}
                      {row.confidence ? <span className="ml-1 text-xs text-gray-400">({row.confidence})</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <PricingRowActions
                        modelKey={row.modelKey}
                        status={row.status}
                        price={{ input: row.input, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output }}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
