"use client";

import { useEffect, useRef, type ReactNode } from "react";

let openModals = 0;
let originalBodyOverflow = "";

/** Native dialogs keep keyboard focus inside and make the background inert. */
export function Modal({ label, busy = false, onClose, children }: {
  label: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    if (openModals === 0) originalBodyOverflow = document.body.style.overflow;
    openModals += 1;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-modal-initial-focus]")?.focus();
    return () => {
      dialog.close();
      openModals -= 1;
      if (openModals === 0) document.body.style.overflow = originalBodyOverflow;
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
    onPointerDown={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      backdropPress.current = event.target === event.currentTarget &&
        (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
    }}
    onPointerCancel={() => { backdropPress.current = false; }}
    onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (backdropPress.current && outside && event.target === event.currentTarget && !busy) onClose();
      backdropPress.current = false;
    }}>
    <section className="modal-card">{children}</section>
  </dialog>;
}
