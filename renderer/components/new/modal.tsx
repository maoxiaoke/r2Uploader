import React, { useEffect, useId, useRef } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { X } from "@openai/apps-sdk-ui/components/Icon";
import { useAppState } from "../../context/app-state";

export const Modal = ({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  const { tx } = useAppState();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((item) => !item.hidden && item.getAttribute("aria-hidden") !== "true");
    requestAnimationFrame(() => (focusable()[0] ?? panelRef.current)?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); previousFocus?.focus(); };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop window-no-drag" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="heading-lg text-primary">{tx(title)}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm text-secondary">{tx(description)}</p> : null}
          </div>
          <Button color="secondary" variant="ghost" size="sm" uniform aria-label={tx("Close")} onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
};
