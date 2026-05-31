"use client";

// Лёгкая toast-система без зависимостей. ARIA-live, авто-дисмисс,
// опциональное действие («Отменить»). Провайдер оборачивает клиентское дерево.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle, WarningCircle, Info, X } from "@phosphor-icons/react";

type ToastType = "success" | "error" | "info";
type ToastInput = { message: string; type?: ToastType; duration?: number; action?: { label: string; onClick: () => void } };
type ToastItem = ToastInput & { id: number; type: ToastType };

type ToastCtx = (t: ToastInput) => void;
const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return () => {}; // вне провайдера — no-op, не падаем
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
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 shadow-pop"
            style={{ animation: "toastIn 0.22s cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <span className={t.type === "success" ? "text-success" : t.type === "error" ? "text-danger" : "text-info"}>
              {ICONS[t.type]}
            </span>
            <span className="min-w-0 flex-1 text-[13.5px] text-ink">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  remove(t.id);
                }}
                className="flex-shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent-soft"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label="Закрыть уведомление"
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }`}</style>
    </Ctx.Provider>
  );
}
