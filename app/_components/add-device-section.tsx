"use client";

import { useState } from "react";
import { MdAdd } from "react-icons/md";
import Modal from "@/components/modal";
import { EnrollFlowCard } from "./enroll-flow-card";

// Button on the /devices page header that opens a modal containing the
// enrollment flow. Replaces the previous inline-expanding card so the
// flow doesn't push the device table down the page.
//
// EnrollFlowCard is only mounted while the modal is open — closing the
// modal unmounts it, which cancels any in-flight polling (the component
// uses `setInterval` internally; React cleans it up on unmount).
export function AddDeviceSection({ initialDeviceIds }: { initialDeviceIds: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
      >
        <MdAdd className="h-4 w-4" />
        添加设备
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        size="2xl"
        title={
          <div>
            添加新设备
            <p className="mt-0.5 text-xs font-normal text-gray-500 dark:text-gray-400">
              生成一次性安装命令，在目标 Mac / Linux / WSL 终端运行即可。
            </p>
          </div>
        }
      >
        {open ? <EnrollFlowCard initialDeviceIds={initialDeviceIds} /> : null}
      </Modal>
    </>
  );
}
