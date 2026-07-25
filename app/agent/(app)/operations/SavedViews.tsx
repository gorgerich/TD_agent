"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookmarkSimple, FloppyDisk, WarningCircle, X } from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";
import { clearCommandId, commandIdFor, type ClientCommandIdentity } from "@/lib/clientCommandId";

type QueryValue = string | number | boolean | null;
type SavedView = {
  id: string;
  name: string;
  scope: "MY" | "TEAM";
  query: Record<string, QueryValue>;
};

export function SavedViews({
  screen,
  scope,
  query,
  onApply,
}: {
  screen: "today" | "team";
  scope: "MY" | "TEAM";
  query: Record<string, QueryValue>;
  onApply: (query: Record<string, QueryValue>) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const command = useRef<ClientCommandIdentity | null>(null);

  const relevantViews = useMemo(
    () => views.filter((view) => view.query.screen === screen),
    [screen, views],
  );

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const response = await fetch("/api/agent/operations/views", { method: "GET", signal });
      const payload = await response.json().catch(() => null) as { views?: SavedView[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Не удалось загрузить сохранённые виды");
      setViews(payload?.views ?? []);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setLoadFailed(true);
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить сохранённые виды");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const start = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(start);
      controller.abort();
    };
  }, [load]);

  async function saveView() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Назовите представление, чтобы его можно было отличить в списке.");
      return;
    }
    if (!navigator.onLine) {
      setError("Нет связи. Представление не сохранено.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = { name: trimmedName, scope, query: { ...query, screen } };
      const commandId = commandIdFor(command, JSON.stringify(body));
      const response = await fetch("/api/agent/operations/views", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": commandId,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { view?: SavedView; error?: string } | null;
      if (!response.ok || !payload?.view) throw new Error(payload?.error ?? "Представление не сохранено");
      setViews((current) => [payload.view!, ...current.filter((view) => view.id !== payload.view!.id)]);
      clearCommandId(command);
      setName("");
      setEditorOpen(false);
      setNotice(`Представление «${trimmedName}» сохранено.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Представление не сохранено");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Сохранённые представления" className="rounded-[var(--radius-card)] bg-surface px-3.5 py-3 shadow-[var(--shadow-xs),var(--hl-top)] sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <BookmarkSimple size={17} weight="fill" className="flex-none text-ink-3" aria-hidden />
        <label className="sr-only" htmlFor={`saved-view-${screen}`}>Сохранённые представления</label>
        <select
          id={`saved-view-${screen}`}
          className="min-h-10 min-w-[180px] flex-1 rounded-[10px] border-0 bg-surface-2 px-3 text-[12px] font-medium text-ink outline-none focus:ring-2 focus:ring-accent/30"
          defaultValue=""
          disabled={loading || relevantViews.length === 0}
          onChange={(event) => {
            const selected = relevantViews.find((view) => view.id === event.target.value);
            if (selected) {
              onApply(selected.query);
              setNotice(`Применено: «${selected.name}».`);
              setError(null);
            }
          }}
        >
          <option value="">{loading ? "Загружаю виды…" : loadFailed ? "Виды не загрузились" : relevantViews.length ? "Выбрать сохранённый вид" : "Сохранённых видов нет"}</option>
          {relevantViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => {
            clearCommandId(command);
            setEditorOpen((current) => !current);
            setError(null);
            setNotice(null);
          }}
          className={buttonClasses({ variant: "ghost", size: "sm" })}
          aria-expanded={editorOpen}
        >
          {editorOpen ? <X size={15} weight="bold" /> : <FloppyDisk size={15} weight="fill" />}
          {editorOpen ? "Закрыть" : "Сохранить текущий вид"}
        </button>
      </div>

      {editorOpen && (
        <form
          className="mt-3 flex min-w-0 flex-col gap-2 border-t border-line pt-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void saveView();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Название представления</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="td-field"
              placeholder={screen === "today" ? "Например, только просроченное" : "Например, кейсы без исполнителя"}
              maxLength={80}
              autoFocus
              disabled={saving}
            />
          </label>
          <button type="submit" disabled={saving} className={buttonClasses({ size: "sm" })}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </form>
      )}

      {error && (
        <div role="alert" className="mt-2.5 flex items-start gap-2 text-[12px] text-danger">
          <WarningCircle size={15} weight="fill" className="mt-0.5 flex-none" />
          <span>{error}</span>
          {loadFailed && !editorOpen && (
            <button type="button" onClick={() => void load()} className="font-semibold text-ink underline decoration-line-strong underline-offset-4">Повторить</button>
          )}
        </div>
      )}
      {notice && <p role="status" className="mt-2 text-[12px] font-medium text-success">{notice}</p>}
    </section>
  );
}
