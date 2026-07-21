"use client";

import { useState } from "react";
import { MdCheck, MdContentCopy } from "react-icons/md";
import { useTranslations } from "next-intl";

type Variant = "banner" | "card";

const VARIANT_STYLES: Record<Variant, { code: string; button: string }> = {
  banner: {
    code: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100",
    button:
      "bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25",
  },
  card: {
    code: "bg-gray-100 text-navy-700 dark:bg-white/5 dark:text-gray-100",
    button:
      "bg-gray-100 text-navy-700 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10",
  },
};

// Reusable code-block + copy-button. Used by the upgrade banner (amber
// variant) and the /devices "Upgrade all devices" card (gray variant).
// navigator.clipboard may throw on non-HTTPS origins; we swallow the
// error silently and leave the button text unchanged so users can still
// select + Ctrl+C manually.
export type InstallCommandOption = { id: string; label: string; command: string };

export function CopyInstallCommand({
  command,
  commands,
  variant,
}: {
  command?: string;
  commands?: InstallCommandOption[];
  variant: Variant;
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const styles = VARIANT_STYLES[variant];

  // Single-command callers keep passing `command`; multi-platform callers pass
  // `commands` and get a platform switcher.
  const options: InstallCommandOption[] =
    commands ?? (command ? [{ id: "default", label: "", command }] : []);
  const active = options.find((option) => option.id === activeId) ?? options[0];
  if (!active) return null;

  return (
    <div className="flex flex-col gap-2">
      {options.length > 1 && (
        <div className="flex items-center gap-1">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setActiveId(option.id);
                setCopied(false);
              }}
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                option.id === active.id ? styles.button : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <code className={`flex-1 truncate rounded-md px-2 py-1 font-mono text-xs ${styles.code}`}>
          {active.command}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(active.command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard API unavailable; ignore
            }
          }}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${styles.button}`}
        >
          {copied ? <MdCheck className="h-3 w-3" /> : <MdContentCopy className="h-3 w-3" />}
          {copied ? t("upgradeBanner.copied") : t("upgradeBanner.copy")}
        </button>
      </div>
    </div>
  );
}
