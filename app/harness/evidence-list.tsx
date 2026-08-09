"use client";

import { useState } from "react";
import { MdCheck, MdContentCopy } from "react-icons/md";
import { classifyEvidenceList, type EvidenceItem } from "@/shared/harness-evidence";

// BL-GATE-INBOX F003：evidence 先行版——路径分类徽标 + 一键复制。
// 内容查看（需 agent 上传）刻意剥离在 BL-GATE-EVIDENCE-UPLOAD。

function CopyButton({ value, copiedLabel, copyLabel }: { value: string; copiedLabel: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copyLabel}
      title={copied ? copiedLabel : copyLabel}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="ml-1 inline-flex shrink-0 items-center rounded p-0.5 text-gray-400 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {copied ? <MdCheck className="h-3.5 w-3.5" /> : <MdContentCopy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function EvidenceList({
  evidence,
  labels
}: {
  evidence: unknown;
  labels: { repoDoc: string; path: string; copy: string; copied: string };
}) {
  const items: EvidenceItem[] = classifyEvidenceList(evidence);
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((item) => (
        <li key={item.raw} className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-gray-500 dark:text-gray-400">
          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${
              item.kind === "repoDoc"
                ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
                : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
            }`}
          >
            {item.kind === "repoDoc" ? labels.repoDoc : labels.path}
          </span>
          <span className="min-w-0 break-all">{item.raw}</span>
          <CopyButton value={item.raw} copyLabel={labels.copy} copiedLabel={labels.copied} />
        </li>
      ))}
    </ul>
  );
}
