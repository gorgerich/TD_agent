"use client";

// Лёгкая toast-система без зависимостей. ARIA-live, авто-дисмисс,
// опциональное действие («Отменить»). Провайдер оборачивает клиентское дерево.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle, WarningCircle, Info, X } from "@phosphor-icons/react";
import { useSwipeX } from "@/lib/useSwipeX";

type ToastType = "success" | "error" | "info";
type ToastInput = { message: string; type?: ToastType; duration?: number; action?: { label: string; onClick: () => void } };
type ToastItem = ToastInput & { id: number; type: ToastType };

type ToastCtx = (t: ToastInput) => void;
const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return () => {}; // вне провайдера - no-op, не падаем
  return ctx;
}

const ICONS = {
  success: <CheckCircle size={18} weight="fill" />,
  error: <WarningCircle size={18} weight="fill" />,
  info: <Info size={18} weight="fill" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);

  const toast = useCallback<ToastCtx>(
    (input) => {
      const id = ++idRef.current;
      const item: ToastItem = { id, type: "info", duration: 4000, ...input };
      setItems((cur) => [...cur, item]);
      if (item.duration && item.duration > 0) {
        window.setTimeout(() => remove(id), item.duration);
      }
    },
    [remove],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1100] flex flex-col items-center gap-2 px-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:items-end sm:pr-6" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

// Swipe-dismiss (DELIGHT, пункт 5): тост уводится пальцем в любую сторону,
// флик коммитит раньше порога. Кнопки внутри жест не ломают (клик после
// драга гасится в хуке).
function ToastCard({ item: t, onClose }: { item: ToastItem; onClose: () => void }) {
  const swipe = useSwipeX({
    dir: "both",
    threshold: 64,
    velocity: 0.4,
    onCommit: () => window.setTimeout(onClose, 180),
  });

  return (
    <div
      {...swipe.bind}
      role={t.type === "error" ? "alert" : "status"}
      className={`td-toast-in pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-[14px] border bg-surface/94 px-4 py-3 shadow-pop backdrop-blur-md ${
        t.type === "success" ? "border-success/25" : t.type === "error" ? "border-danger/25" : "border-info/20"
      }`}
      style={{
        transform: swipe.committed
          ? `translateX(${swipe.committed === "right" ? "calc(100% + 24px)" : "calc(-100% - 24px)"})`
          : `translateX(${swipe.dx}px)`,
        opacity: swipe.committed ? 0 : 1 - swipe.progress * 0.35,
        transition: swipe.dragging ? "none" : "transform 0.2s var(--ease-out), opacity 0.2s var(--ease-out)",
        touchAction: "pan-y",
      }}
    >
      <span className={t.type === "success" ? "text-success" : t.type === "error" ? "text-danger" : "text-info"}>
        {ICONS[t.type]}
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-ink">{t.message}</span>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action!.onClick();
            onClose();
          }}
          className="td-press flex-shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть уведомление"
        className="td-icon-button h-7 w-7 flex-shrink-0 rounded-full"
      >
        <X size={14} />
      </button>
    </div>
  );
}
