"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarBlank, CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { clearCommandId, commandIdFor, type ClientCommandIdentity } from "@/lib/clientCommandId";
import { zonedLocalInput, zonedLocalToIso } from "@/lib/zonedDateTime";

type MeetingAction = "confirm" | "complete" | "no_show" | "cancel" | "reschedule";

const ACTIONS: Record<string, Array<{ action: MeetingAction; label: string; tone: "primary" | "secondary" }>> = {
  TENTATIVE: [{ action: "reschedule", label: "Согласовать время", tone: "primary" }],
  SCHEDULED: [
    { action: "confirm", label: "Подтвердить встречу", tone: "primary" },
    { action: "complete", label: "Зафиксировать итог", tone: "secondary" },
    { action: "reschedule", label: "Перенести", tone: "secondary" },
    { action: "no_show", label: "Не состоялась", tone: "secondary" },
    { action: "cancel", label: "Отменить", tone: "secondary" },
  ],
  CONFIRMED: [
    { action: "complete", label: "Зафиксировать итог", tone: "primary" },
    { action: "reschedule", label: "Перенести", tone: "secondary" },
    { action: "no_show", label: "Не состоялась", tone: "secondary" },
    { action: "cancel", label: "Отменить", tone: "secondary" },
  ],
};

export default function MeetingActions({
  meetingId,
  currentStatus,
  currentVersion,
  scheduledAt,
  durationMinutes,
  timezone,
  canMutate,
}: {
  meetingId: number;
  currentStatus: string;
  currentVersion: number;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timezone: string;
  canMutate: boolean;
}) {
  const router = useRouter();
  const online = useOnline();
  const [selected, setSelected] = useState<MeetingAction | null>(null);
  const [details, setDetails] = useState("");
  const [dateTime, setDateTime] = useState(scheduledAt ? zonedLocalInput(scheduledAt, timezone) : "");
  const [duration, setDuration] = useState(String(durationMinutes ?? 60));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const command = useRef<ClientCommandIdentity | null>(null);
  const actions = useMemo(() => ACTIONS[currentStatus] ?? [], [currentStatus]);

  useEffect(() => {
    if (selected && selected !== "confirm") detailsRef.current?.focus();
  }, [selected]);

  function choose(action: MeetingAction) {
    clearCommandId(command);
    setSelected(action);
    setDetails("");
    setError(null);
    setNotice(null);
  }

  async function submit() {
    if (!selected || pending) return;
    if (!online) {
      setError("Нет связи. Изменение не отправлено, текущий статус сохранён.");
      return;
    }
    const trimmed = details.trim();
    if (selected !== "confirm" && !trimmed) {
      setError(selected === "complete" || selected === "no_show" ? "Опишите фактический результат встречи." : "Укажите причину изменения.");
      return;
    }
    const nextDate = selected === "reschedule" && dateTime ? zonedLocalToIso(dateTime, timezone) : null;
    if (selected === "reschedule" && dateTime && !nextDate) {
      setError("Проверьте дату и время.");
      return;
    }

    const body = selected === "reschedule"
      ? { action: selected, scheduledAt: nextDate, durationMinutes: Number(duration) || null, reason: trimmed, version: currentVersion }
      : selected === "complete" || selected === "no_show"
        ? { action: selected, outcome: trimmed, version: currentVersion }
        : selected === "cancel"
          ? { action: selected, reason: trimmed, version: currentVersion }
          : { action: selected, version: currentVersion };
    const commandId = commandIdFor(command, JSON.stringify({ meetingId, ...body }));

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/meetings/${meetingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": commandId,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(response.status === 409
          ? "Встреча уже изменена в другом окне. Обновите страницу перед повтором."
          : response.status === 403
            ? "Недостаточно прав для изменения этой встречи."
            : payload?.error ?? "Изменение не сохранено. Повторите действие.");
        return;
      }
      setNotice(selected === "reschedule" ? "Новое время и причина сохранены." : "Статус и результат встречи сохранены.");
      clearCommandId(command);
      setSelected(null);
      router.refresh();
    } catch {
      setError("Связь прервалась. Изменение не сохранено.");
    } finally {
      setPending(false);
    }
  }

  if (!canMutate) {
    return <p className="mt-5 text-[12px] text-ink-3">Режим аудитора: встреча доступна только для чтения.</p>;
  }
  if (actions.length === 0) return null;

  return (
    <section className="mt-5 rounded-[var(--radius-card)] bg-surface px-4 py-4 shadow-[var(--shadow-xs),var(--hl-top)] sm:px-5" aria-busy={pending}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Следующее действие</h2>
          <p className="mt-1 text-[12px] text-ink-3">Фиксируйте не отметку, а фактический исход и причину.</p>
        </div>
        {!online && <span className="flex items-center gap-1.5 text-[12px] font-medium text-warning"><WarningCircle size={16} weight="fill" /> Офлайн</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((item) => (
          <Button key={item.action} type="button" size="sm" variant={item.tone} onClick={() => choose(item.action)} disabled={pending}>
            {item.action === "reschedule" && <CalendarBlank size={15} weight="bold" />}
            {item.label}
          </Button>
        ))}
      </div>

      {notice && <p role="status" className="mt-4 flex items-start gap-2 text-[12px] text-success"><CheckCircle size={16} weight="fill" /> {notice}</p>}

      {selected && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-ink">{actionTitle(selected)}</p>
            <button type="button" onClick={() => { clearCommandId(command); setSelected(null); }} className="grid min-h-10 min-w-10 place-items-center text-ink-3 hover:text-ink" aria-label="Закрыть форму">
              <X size={17} weight="bold" />
            </button>
          </div>
          {selected === "reschedule" && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
              <label className="block text-[12px] font-medium text-ink-2">
                Дата и время · {timezone}
                <input type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} className="td-field mt-1.5" />
              </label>
              <label className="block text-[12px] font-medium text-ink-2">
                Минут
                <input type="number" min={15} max={720} step={15} value={duration} onChange={(event) => setDuration(event.target.value)} className="td-field mt-1.5" />
              </label>
            </div>
          )}
          {selected !== "confirm" && (
            <label className="mt-3 block text-[12px] font-medium text-ink-2">
              {selected === "complete" || selected === "no_show" ? "Фактический результат" : "Причина"}
              <textarea
                ref={detailsRef}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={3}
                maxLength={selected === "reschedule" ? 1000 : 2000}
                className="td-field mt-1.5 resize-y"
                placeholder={selected === "complete" ? "Например: согласовали состав услуг и следующий контакт" : selected === "reschedule" ? "Почему время изменилось" : "Что произошло"}
              />
            </label>
          )}
          {error && <p role="alert" className="mt-3 flex items-start gap-2 text-[12px] text-danger"><WarningCircle size={16} weight="fill" /> {error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void submit()} loading={pending}>Сохранить</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { clearCommandId(command); setSelected(null); }} disabled={pending}>Отмена</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function actionTitle(action: MeetingAction) {
  if (action === "confirm") return "Подтвердить встречу";
  if (action === "complete") return "Итог встречи";
  if (action === "no_show") return "Встреча не состоялась";
  if (action === "cancel") return "Отмена встречи";
  return "Новое время";
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
