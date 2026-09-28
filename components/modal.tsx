"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native dialogs keep keyboard focus inside and make the background inert. */
export function Modal({ label, busy = false, onClose, children }: {
  label: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-modal-initial-focus]")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className="workspace-dialog" aria-label={label} tabIndex={-1}
    aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal-card">{children}</section>
  </dialog>;
}
