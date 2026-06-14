"use client";

// Премиум правый sheet на токенах TD. Portal в body, backdrop-blur,
// drawer-вход (sheetInRight), drag-to-close (useSwipeX), Esc, scroll-lock, focus.
// Унифицирует sheet-паттерн (раньше дублировался в NewCaseSheet).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { useSwipeX } from "@/lib/useSwipeX";

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  busy = false,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Блокирует drag-close/overlay-close во время сохранения. */
  busy?: boolean;
  width?: number;
}) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const swipe = useSwipeX({
    dir: "right",
    threshold: 140,
    velocity: 0.5,
    enabled: open && !busy,
    onCommit: () => close(),
  });

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => {
      closingRef.current = false;
      setClosing(false);
      swipe.reset();
      onClose();
    }, 220);
  }

  useEffect(() => {
    if (!open) return;
    // Фокус на первое поле/кнопку панели.
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input,textarea,select,button,[tabindex]",
    );
    first?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-[rgba(10,18,32,0.45)] backdrop-blur-[2px]"
        style={{
          animation: closing ? undefined : "overlayFade 0.2s ease-out",
          opacity: closing ? 0 : 1 - swipe.progress * 0.4,
          transition: swipe.dragging ? "none" : "opacity 0.2s ease-out",
        }}
        onClick={() => !busy && close()}
      />
      <div
        ref={panelRef}
        {...swipe.bind}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-pop"
        style={{
          maxWidth: width,
          animation: closing ? undefined : "sheetInRight 0.36s var(--ease-drawer)",
          transform: closing ? "translateX(100%)" : swipe.dx > 0 ? `translateX(${swipe.dx}px)` : undefined,
          transition: swipe.dragging ? "none" : "transform 0.26s var(--ease-drawer)",
          touchAction: "pan-y",
        }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="td-display text-[20px] text-ink">{title}</h2>
          <button type="button" onClick={close} aria-label="Закрыть" className="td-icon-button h-9 w-9">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export default Sheet;
