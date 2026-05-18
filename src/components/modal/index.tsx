"use client";

import { useEffect, useRef } from "react";
import { MdClose } from "react-icons/md";
import type { ReactNode } from "react";

type Size = "sm" | "md" | "lg" | "xl" | "2xl";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-3xl",
};

// Built on the native <dialog> element so focus trap, ESC-to-close,
// scroll lock, and inert background come from the browser. The
// imperative showModal()/close() API is mirrored from the controlled
// `isOpen` prop via useEffect. Reaches for <dialog> rather than Chakra
// or another headless library because no matching provider is set up
// elsewhere in this app — keeping this dependency-free avoids coupling.
export default function ModalDialog({
  isOpen,
  onClose,
  title,
  size = "lg",
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: Size;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // When shown via showModal() the dialog fills the viewport; a
        // click on the backdrop registers with target === currentTarget.
        if (e.target === e.currentTarget) onClose();
      }}
      className={`w-[calc(100%-2rem)] ${SIZE_CLASSES[size]} rounded-2xl bg-white p-0 text-navy-700 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm dark:bg-navy-800 dark:text-white`}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-navy-700 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <MdClose className="h-5 w-5" />
        </button>
        {title ? (
          <div className="px-6 pb-2 pr-12 pt-5 text-lg font-bold text-navy-700 dark:text-white">
            {title}
          </div>
        ) : null}
        <div className="px-6 pb-6 pt-2">{children}</div>
      </div>
    </dialog>
  );
}
