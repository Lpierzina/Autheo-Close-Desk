"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./ui";

/**
 * A modal confirmation built on the native dialog element, so focus is trapped, Escape
 * cancels, and focus returns to the control that opened it.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      className="m-auto w-[min(92vw,460px)] rounded-lg border border-line-strong bg-surface p-0 text-ink shadow-[0_24px_60px_-20px_rgba(13,27,51,0.45)] backdrop:bg-navy-950/45"
    >
      <div className="px-6 pb-5 pt-6">
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">
          {children}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-paper px-6 py-3.5">
        <Button onClick={onCancel} autoFocus>
          {cancelLabel}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
