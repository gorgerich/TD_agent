"use client";

// Лёгкий popover-меню на токенах TD. Click-trigger, click-outside + Esc закрытие,
// якорь под триггером справа. Для overflow-действий по строке (Linear/Raycast).
// Без внешних зависимостей.

import { useEffect, useRef, useState } from "react";

export type PopoverItem = {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  danger?: boolean;
};

export function Popover({
  trigger,
  items,
  align = "end",
  label = "Действия",
}: {
  trigger: React.ReactNode;
  items: PopoverItem[];
  align?: "start" | "end";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="td-icon-button h-10 w-10"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`td-popover td-popover-in absolute z-50 mt-1 min-w-[200px] overflow-hidden p-1 ${align === "end" ? "right-0" : "left-0"}`}
          style={{ transformOrigin: align === "end" ? "top right" : "top left" }}
        >
          {items.map((item, i) => {
            const cls = `flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] font-medium transition-colors ${
              item.danger ? "text-danger hover:bg-danger-soft" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`;
            const content = (
              <>
                {item.icon && <span className="flex-shrink-0 text-ink-3">{item.icon}</span>}
                {item.label}
              </>
            );
            const handle = () => { setOpen(false); item.onClick?.(); };
            return item.href ? (
              <a
                key={i}
                href={item.href}
                {...(item.external ? { target: "_blank", rel: "noopener" } : {})}
                role="menuitem"
                className={cls}
                onClick={() => setOpen(false)}
              >
                {content}
              </a>
            ) : (
              <button key={i} type="button" role="menuitem" className={cls} onClick={handle}>
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Popover;
