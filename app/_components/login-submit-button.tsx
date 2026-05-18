"use client";

import { useFormStatus } from "react-dom";
import { MdMailOutline } from "react-icons/md";

// Submit button that reads pending state from the nearest ancestor
// <form> via React 19's useFormStatus(). Lets the form stay
// server-rendered while still giving the user a disabled/spinner state
// during the in-flight server action. Must be imported from react-dom,
// not react.
export function LoginSubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-sm font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-brand-500 disabled:active:scale-100"
    >
      {pending ? <Spinner /> : <MdMailOutline className="h-4 w-4" />}
      <span>{pending ? pendingLabel : idleLabel}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
