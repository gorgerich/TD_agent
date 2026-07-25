"use client";

import { useRef, useState } from "react";
import { Check, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { clearCommandId, commandIdFor, type ClientCommandIdentity } from "@/lib/clientCommandId";

export type Intake = {
  ceremonyType: string;
  budget: string;
  religion: string;
  needs: string;
  deceasedName: string;
  deceasedDate: string;
  morgue: string;
  ceremonyAt: string;
  ceremonyPlace: string;
};

const CEREMONY = ["кремация", "погребение"] as const;

export function IntakeSection({ caseId, initial, canMutate = true }: { caseId: number; initial: Intake; canMutate?: boolean }) {
  const [value, setValue] = useState<Intake>(initial);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const command = useRef<ClientCommandIdentity | null>(null);

  function set<K extends keyof Intake>(key: K, next: Intake[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    setOk(false);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const commandId = commandIdFor(command, JSON.stringify(value));
      const res = await fetch(`/api/agent/cases/${caseId}/intake`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `intake-save:${caseId}:${commandId}`,
          "X-Correlation-Id": `case:${caseId}:${commandId}`,
        },
        body: JSON.stringify(value),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Не удалось сохранить. Попробуйте снова.");
        return;
      }
      clearCommandId(command);
      setOk(true);
    } catch {
      setErr("Нет связи. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="td-work-kicker">
        <span>Краткая карточка семьи и церемонии</span>
        <span className="text-ink-3">Видно только агенту</span>
      </div>

      <fieldset disabled={!canMutate} className="border-b border-line pb-6 disabled:opacity-80">
        <legend className="mb-4 text-[13px] font-semibold text-ink">Усопший и церемония</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ФИО усопшего">
            <input aria-label="ФИО усопшего" className="td-field" placeholder="Иванов Иван Иванович" value={value.deceasedName} onChange={(e) => set("deceasedName", e.target.value)} />
          </Field>
          <Field label="Дата смерти">
            <input aria-label="Дата смерти" type="date" className="td-field" value={value.deceasedDate} onChange={(e) => set("deceasedDate", e.target.value)} />
          </Field>
          <Field label="Морг / где находится">
            <input aria-label="Морг или место нахождения" className="td-field" placeholder="Например, морг ГКБ №1" value={value.morgue} onChange={(e) => set("morgue", e.target.value)} />
          </Field>
          <Field label="Дата и время церемонии">
            <input aria-label="Дата и время церемонии" type="datetime-local" className="td-field" value={value.ceremonyAt} onChange={(e) => set("ceremonyAt", e.target.value)} />
          </Field>
          <Field label="Кладбище / крематорий" className="sm:col-span-2">
            <input aria-label="Кладбище или крематорий" className="td-field" placeholder="Например, Хованское кладбище" value={value.ceremonyPlace} onChange={(e) => set("ceremonyPlace", e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset disabled={!canMutate} className="border-b border-line pb-6 disabled:opacity-80">
        <legend className="mb-4 text-[13px] font-semibold text-ink">Пожелания семьи</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Тип церемонии" className="sm:col-span-2">
            <div className="td-segmented">
              {CEREMONY.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => set("ceremonyType", value.ceremonyType === item ? "" : item)}
                  data-active={value.ceremonyType === item ? "true" : undefined}
                  className="td-segment min-h-10 flex-1 capitalize"
                >
                  {item}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Ориентир по бюджету">
            <input aria-label="Ориентир по бюджету" className="td-field" placeholder="Например, 80-120 тыс. ₽" value={value.budget} onChange={(e) => set("budget", e.target.value)} />
          </Field>
          <Field label="Традиция / конфессия">
            <input aria-label="Традиция или конфессия" className="td-field" placeholder="Например, православная" value={value.religion} onChange={(e) => set("religion", e.target.value)} />
          </Field>
          <Field label="Особые пожелания" className="sm:col-span-2" help="Ограничения, важные детали и всё, что должно сохраниться для команды.">
            <textarea
              aria-label="Особые пожелания"
              className="td-field resize-y"
              placeholder="Пожелания семьи, ограничения, важные детали"
              value={value.needs}
              onChange={(e) => set("needs", e.target.value)}
              maxLength={2000}
            />
          </Field>
        </div>
      </fieldset>

      {canMutate ? <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" loading={busy} onClick={save}>Сохранить изменения</Button>
        {ok && <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-success"><Check size={15} weight="bold" /> Сохранено</span>}
        {err && <span role="alert" className="inline-flex max-w-full items-center gap-1.5 text-[12px] font-medium text-danger"><Warning size={15} weight="fill" /> {err}</span>}
      </div> : <p className="text-[12px] text-ink-3">Данные семьи доступны для контекста. Изменяет их владелец кейса.</p>}
    </div>
  );
}

function Field({
  label,
  help,
  className = "",
  children,
}: {
  label: string;
  help?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`block min-w-0 ${className}`}>
      <span className="td-field-label">{label}</span>
      {children}
      {help && <span className="td-field-help">{help}</span>}
    </div>
  );
}

export default IntakeSection;
