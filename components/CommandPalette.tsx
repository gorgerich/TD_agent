"use client";

// Командная палитра (⌘K / Ctrl+K). Быстрая навигация и действия с клавиатуры -
// big-tech-паттерн (Linear/Raycast/Vercel). Только агентский кабинет.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  Briefcase,
  CalendarDots,
  Plus,
  GraduationCap,
  ArrowRight,
  FileText,
  Files,
  CheckSquare,
  GearSix,
  Package,
  CurrencyRub,
  User,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { TOUR_START_EVENT } from "@/lib/tour";

/** Открыть палитру из любого места (кнопка в сайдбаре и т.п.). */
export const COMMAND_OPEN_EVENT = "td:open-command";

type Command = {
  id: string;
  label: string;
  hint?: string;
  meta?: string;
  keywords: string;
  icon: React.ComponentType<{
    size?: number;
    weight?: "regular" | "fill" | "duotone" | "bold";
    className?: string;
  }>;
  run: () => void;
};

type SearchResult = {
  id: string;
  kind: "CASE" | "CLIENT" | "TASK" | "MEETING";
  label: string;
  meta: string;
  href: string;
};

type SearchState = "idle" | "loading" | "success" | "offline" | "forbidden" | "error";

const SEARCH_DELAY_MS = 240;

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [retryKey, setRetryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    setSearchResults([]);
    setSearchState("idle");
  }, []);

  const show = useCallback(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const commands: Command[] = useMemo(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    return [
      { id: "cases", label: "Кейсы", keywords: "кейсы дела клиенты лиды crm база", icon: Briefcase, run: go("/agent/cases") },
      { id: "meetings", label: "Календарь", keywords: "встречи расписание календарь", icon: CalendarDots, run: go("/agent/meetings") },
      { id: "estimates", label: "Сметы", keywords: "сметы расчет заказ quote estimates", icon: FileText, run: go("/agent/estimates") },
      { id: "catalog", label: "Каталог", keywords: "каталог товары атрибутика гробы венки маркетплейс", icon: Package, run: go("/agent/catalog") },
      { id: "documents", label: "Документы", keywords: "документы договор подпись паспорт", icon: Files, run: go("/agent/documents") },
      { id: "tasks", label: "Задачи", keywords: "задачи дедлайны todo чеклист", icon: CheckSquare, run: go("/agent/tasks") },
      { id: "commissions", label: "Комиссии", keywords: "комиссии деньги выплаты финансы заработок", icon: CurrencyRub, run: go("/agent/commissions") },
      { id: "settings", label: "Настройки", keywords: "настройки профиль агент", icon: GearSix, run: go("/agent/settings") },
      { id: "new-case", label: "Новый кейс", hint: "Создать", keywords: "новый кейс клиент добавить создать лид", icon: Plus, run: go("/agent/leads/new") },
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

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords.includes(q),
    );
  }, [commands, query]);

  const remoteCommands = useMemo<Command[]>(
    () =>
      searchResults.map((result) => ({
        id: result.id,
        label: result.label,
        hint: searchResultHint(result.kind),
        meta: result.meta,
        keywords: "",
        icon: searchResultIcon(result.kind),
        run: () => {
          close();
          router.push(result.href);
        },
      })),
    [close, router, searchResults],
  );

  const filtered = useMemo(
    () => [...remoteCommands, ...filteredCommands],
    [filteredCommands, remoteCommands],
  );

  // Сервер ограничивает поиск текущей организацией и ролью. Debounce не создаёт
  // гонок: предыдущий запрос отменяется при каждом изменении строки.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/agent/operations/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (response.status === 403) {
          setSearchState("forbidden");
          setSearchResults([]);
          return;
        }
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);
        const payload: unknown = await response.json();
        if (!isSearchPayload(payload)) throw new Error("Invalid search response");
        setSearchResults(payload.results);
        setSearchState("success");
        setActive(0);
      } catch {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setSearchState(navigator.onLine ? "error" : "offline");
        setActive(0);
      }
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, retryKey]);

  // Глобальный хоткей ⌘K / Ctrl+K.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    }
    function onOpen() {
      show();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_OPEN_EVENT, onOpen);
    };
  }, [close, open, show]);

  // Фокус в инпут при открытии; сброс активного индекса при изменении фильтра.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    if (!open && wasOpenRef.current) {
      window.requestAnimationFrame(() => previousFocusRef.current?.focus());
    }
    wasOpenRef.current = open;
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]):not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = e.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
      e.preventDefault();
      focusable[nextIndex]?.focus();
      return;
    }
    if (e.target !== inputRef.current) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
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
      <div className="absolute inset-0 bg-[rgba(8,14,28,0.42)] backdrop-blur-[3px]" />
      <div
        ref={panelRef}
        className="td-popover td-popover-in relative w-full max-w-[560px] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line bg-surface/72 px-4 py-3.5">
          <MagnifyingGlass size={18} className="flex-shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              const nextQuery = e.target.value;
              setQuery(nextQuery);
              setActive(0);
              setSearchResults([]);
              setSearchState(nextQuery.trim().length >= 2 ? "loading" : "idle");
            }}
            placeholder="Кейс, клиент, задача, встреча или действие…"
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
            aria-label="Поиск команд"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={filtered[active] ? `command-option-${filtered[active].id}` : undefined}
          />
          <kbd className="hidden flex-shrink-0 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-3 sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {query.trim().length >= 2 && (
            <SearchStatus
              state={searchState}
              hasResults={remoteCommands.length > 0}
              hasCommands={filteredCommands.length > 0}
              onRetry={() => {
                setSearchState("loading");
                setRetryKey((key) => key + 1);
              }}
            />
          )}

          <div
            id="command-palette-list"
            role="listbox"
            aria-label="Результаты поиска и команды"
            aria-busy={searchState === "loading"}
          >
            {remoteCommands.length > 0 && (
              <CommandSection
                label="Кейсы, клиенты, задачи и встречи"
                commands={remoteCommands}
                offset={0}
                active={active}
                setActive={setActive}
              />
            )}

            {filteredCommands.length > 0 && (
              <CommandSection
                label={query.trim() ? "Команды" : "Навигация и действия"}
                commands={filteredCommands}
                offset={remoteCommands.length}
                active={active}
                setActive={setActive}
              />
            )}
          </div>

          {query.trim().length < 2 && query.trim().length > 0 && filteredCommands.length === 0 && (
            <p className="px-3 py-7 text-center text-[13px] leading-5 text-ink-3">
              Введите ещё один символ для поиска по рабочим данным.
            </p>
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

function CommandSection({
  label,
  commands,
  offset,
  active,
  setActive,
}: {
  label: string;
  commands: Command[];
  offset: number;
  active: number;
  setActive: (index: number) => void;
}) {
  return (
    <section role="group" aria-label={label} className="py-1">
      <p className="px-3 pb-1.5 pt-2 text-[11px] font-medium text-ink-3">{label}</p>
      {commands.map((command, localIndex) => {
        const index = offset + localIndex;
        const Icon = command.icon;
        const isActive = index === active;
        return (
          <button
            id={`command-option-${command.id}`}
            key={command.id}
            type="button"
            role="option"
            aria-selected={isActive}
            data-idx={index}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={command.run}
            tabIndex={-1}
            className={`td-entity-row flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150 ${
              isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            <Icon
              size={19}
              weight={isActive ? "fill" : "bold"}
              className={`flex-shrink-0 ${isActive ? "text-accent" : "text-ink-3"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{command.label}</span>
              {command.meta && (
                <span className="mt-0.5 block truncate text-[12px] font-normal text-ink-3">
                  {command.meta}
                </span>
              )}
            </span>
            {command.hint && (
              <span className="flex-shrink-0 text-[11px] font-medium text-ink-3">{command.hint}</span>
            )}
            {isActive && <ArrowRight size={15} weight="bold" className="flex-shrink-0 text-accent" />}
          </button>
        );
      })}
    </section>
  );
}

function SearchStatus({
  state,
  hasResults,
  hasCommands,
  onRetry,
}: {
  state: SearchState;
  hasResults: boolean;
  hasCommands: boolean;
  onRetry: () => void;
}) {
  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-ink-3" role="status">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        Ищем в рабочей зоне…
      </div>
    );
  }

  if (state === "error" || state === "offline" || state === "forbidden") {
    const message = state === "offline"
      ? "Нет подключения. Команды навигации остаются доступны."
      : state === "forbidden"
        ? "Поиск рабочих данных недоступен для вашей роли."
        : "Не удалось выполнить поиск. Команды остаются доступны.";
    return (
      <div className="mx-1 my-2 flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-3" role="alert">
        <p className="min-w-0 flex-1 text-[12px] leading-5 text-ink-2">
          {message}
        </p>
        {state !== "forbidden" && <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold text-accent hover:bg-accent-soft"
        >
          <ArrowClockwise size={15} weight="bold" />
          Повторить
        </button>}
      </div>
    );
  }

  if (state === "success" && !hasResults && !hasCommands) {
    return (
      <div className="px-4 py-8 text-center" role="status">
        <p className="text-[14px] font-semibold text-ink">Совпадений нет</p>
        <p className="mx-auto mt-1 max-w-[34ch] text-[12px] leading-5 text-ink-3">
          Проверьте имя клиента, номер кейса, задачу или встречу.
        </p>
      </div>
    );
  }

  return null;
}

function searchResultHint(kind: SearchResult["kind"]) {
  if (kind === "CASE") return "Кейс / клиент";
  if (kind === "CLIENT") return "Клиент";
  if (kind === "TASK") return "Задача";
  return "Встреча";
}

function searchResultIcon(kind: SearchResult["kind"]): Command["icon"] {
  if (kind === "TASK") return CheckSquare;
  if (kind === "MEETING") return CalendarDots;
  if (kind === "CLIENT") return User;
  return Briefcase;
}

function isSearchPayload(value: unknown): value is { results: SearchResult[] } {
  if (!value || typeof value !== "object" || !("results" in value)) return false;
  const results = (value as { results?: unknown }).results;
  return Array.isArray(results) && results.every(isSearchResult);
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<SearchResult>;
  return (
    typeof result.id === "string" &&
    (result.kind === "CASE" || result.kind === "CLIENT" || result.kind === "TASK" || result.kind === "MEETING") &&
    typeof result.label === "string" &&
    typeof result.meta === "string" &&
    typeof result.href === "string" &&
    result.href.startsWith("/agent/")
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="grid h-5 min-w-5 place-items-center rounded border border-line bg-surface px-1 text-[10px] font-semibold text-ink-3">
      {children}
    </kbd>
  );
}
