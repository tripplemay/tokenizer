"use client";

import type { ReactNode } from "react";
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton } from "@chakra-ui/modal";

// Tailwind-skinned wrapper around Chakra's Modal — same pattern as
// src/components/popover/index.tsx and src/components/tooltip/index.tsx.
// The `!` modifier on Tailwind classes is necessary because Chakra ships
// inline styles whose specificity beats plain class rules.
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
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  children: ReactNode;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size={size} isCentered>
      <ModalOverlay className="bg-black/40 backdrop-blur-sm" />
      <ModalContent className="!rounded-2xl !bg-white !shadow-2xl dark:!bg-navy-800">
        {title ? (
          <ModalHeader className="!px-6 !pt-5 !pb-2 text-lg font-bold text-navy-700 dark:text-white">
            {title}
          </ModalHeader>
        ) : null}
        <ModalCloseButton className="!top-3 !right-3 !text-gray-500 hover:!text-navy-700 dark:hover:!text-white" />
        <ModalBody className="!px-6 !pb-6 !pt-2">{children}</ModalBody>
      </ModalContent>
    </Modal>
  );
}
