"use client";

// Тихий tooltip на токенах TD. Hover/focus-show, задержка, без зависимостей.
// Для icon-only кнопок и сокращений. На тач показывается по focus.

import { useId, useRef, useState } from "react";

let tooltipWarm = false;
let warmTimer: ReturnType<typeof setTimeout> | null = null;

export function Tooltip({
  label,
  children,
  side = "top",
  delay = 350,
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
  delay?: number;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  function open() {
    if (warmTimer) clearTimeout(warmTimer);
    if (tooltipWarm) {
      setShow(true);
      return;
    }
    timer.current = setTimeout(() => {
      tooltipWarm = true;
      setShow(true);
    }, delay);
  }
  function close() {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
    warmTimer = setTimeout(() => {
      tooltipWarm = false;
    }, 700);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      aria-describedby={show ? id : undefined}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          id={id}
          className={`td-tooltip-in pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-night px-2 py-1 text-[11px] font-medium text-on-accent shadow-pop ${
            side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          }`}
          style={{ transformOrigin: side === "top" ? "bottom center" : "top center" }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

export default Tooltip;
