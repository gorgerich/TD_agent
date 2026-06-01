"use client";

// Командная палитра (⌘K / Ctrl+K). Быстрая навигация и действия с клавиатуры —
// big-tech-паттерн (Linear/Raycast/Vercel). Только агентский кабинет.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  House,
  Users,
  CalendarDots,
  Plus,
  GraduationCap,
  ArrowRight,
} from "@phosphor-icons/react";
import { CurrencyRub } from "@phosphor-icons/react/dist/csr/CurrencyRub";
import { TOUR_START_EVENT } from "@/lib/tour";

/** Открыть палитру из любого места (кнопка в сайдбаре и т.п.). */
export const COMMAND_OPEN_EVENT = "td:open-command";

type Command = {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number; weight?: "regular" | "fill" | "duotone" | "bold" }>;
  run: () => void;
};

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const commands: Command[] = useMemo(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    return [
      { id: "dashboard", label: "Главная", keywords: "дашборд главная home обзор", icon: House, run: go("/agent/dashboard") },
      { id: "leads", label: "Клиенты", keywords: "клиенты лиды crm база", icon: Users, run: go("/agent/leads") },
      { id: "meetings", label: "Встречи", keywords: "встречи расписание календарь", icon: CalendarDots, run: go("/agent/meetings") },
      { id: "commissions", label: "Комиссии", keywords: "комиссии финансы выплаты деньги", icon: CurrencyRub, run: go("/agent/commissions") },
      { id: "new-lead", label: "Новый клиент", hint: "Создать", keywords: "новый клиент добавить создать лид", icon: Plus, run: go("/agent/leads/new") },
      { id: "new-meeting", label: "Назначить встречу", hint: "Создать", keywords: "новая встреча назначить создать", icon: Plus, run: go("/agent/meetings/new") },
      {
        id: "tour",
        label: "Запустить обучение",
        hint: "Тур",
        keywords: "обучение тур помощь подсказки онбординг",
        icon: GraduationCap,
        run: () => {
          close();
          window.dispatchEvent(new Event(TOUR_START_EVENT));
        },
      },
    ];
  }, [router, close]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords.includes(q),
    );
  }, [commands, query]);

  // Глобальный хоткей ⌘K / Ctrl+K.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_OPEN_EVENT, onOpen);
    };
  }, []);

  // Фокус в инпут при открытии; сброс активного индекса при изменении фильтра.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (active >= filtered.length && filtered.length > 0) {
    // Корректировка во время рендера (паттерн React вместо эффекта).
    setActive(0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    }
  }

  // Прокрутить активный пункт в зону видимости.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Командная палитра"
      onMouseDown={close}
    >
      <div className="absolute inset-0 bg-[rgba(20,16,11,0.5)] backdrop-blur-[2px]" />
      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <MagnifyingGlass size={18} className="flex-shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск действий и страниц…"
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            aria-label="Поиск команд"
          />
          <kbd className="hidden flex-shrink-0 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-3 sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13.5px] text-ink-3">Ничего не найдено</p>
          ) : (
            filtered.map((c, i) => {
              const Icon = c.icon;
              const isActive = i === active;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={c.run}
                  className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors ${
                    isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-[9px] ${
                      isActive ? "bg-accent text-on-accent" : "bg-surface-2 text-ink-3"
                    }`}
                  >
                    <Icon size={16} weight={isActive ? "fill" : "regular"} />
                  </span>
                  <span className="flex-1 text-[14px] font-medium">{c.label}</span>
                  {c.hint && (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{c.hint}</span>
                  )}
                  {isActive && <ArrowRight size={14} className="text-accent" />}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-line bg-surface-2/60 px-4 py-2 text-[11px] text-ink-3">
          <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> навигация</span>
          <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> выбрать</span>
          <span className="ml-auto inline-flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd> вызвать</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="grid h-5 min-w-5 place-items-center rounded border border-line bg-surface px-1 text-[10.5px] font-semibold text-ink-3">
      {children}
    </kbd>
  );
}
