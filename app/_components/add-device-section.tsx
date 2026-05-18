"use client";

import { useState } from "react";
import { MdAdd, MdClose } from "react-icons/md";
import Card from "@/components/card";
import { EnrollFlowCard } from "./enroll-flow-card";

// Collapsible "add device" panel for the /devices page. Defaults closed so
// the existing visitor sees their device table first; opens inline when
// clicked so the enrollment flow doesn't require a route change or modal.
export function AddDeviceSection({ initialDeviceIds }: { initialDeviceIds: string[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
      >
        <MdAdd className="h-4 w-4" />
        添加设备
      </button>
    );
  }

  return (
    <Card extra="p-6 border border-brand-500/30">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">添加新设备</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            生成一次性安装命令,在目标 Mac / Linux / WSL 终端运行即可。
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="关闭"
          className="rounded-full p-1 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-white/5"
        >
          <MdClose className="h-5 w-5" />
        </button>
      </div>
      <EnrollFlowCard initialDeviceIds={initialDeviceIds} />
    </Card>
  );
}
