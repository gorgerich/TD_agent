"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";

const SOURCES = [
  { value: "agent", label: "Агент" },
  { value: "telegram", label: "Telegram" },
  { value: "call", label: "Звонок" },
  { value: "site", label: "Сайт" },
  { value: "other", label: "Другое" },
];

// Создание кейса за 30-60 сек: правый sheet поверх списка дел. Минимум полей.
export default function NewCaseSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ceremony, setCeremony] = useState<"" | "кремация" | "погребение">("");
  const [source, setSource] = useState("agent");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);

  const valid = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const context = [ceremony ? `Тип: ${ceremony}.` : "", comment.trim()].filter(Boolean).join(" ");
    try {
      commandId.current ??= crypto.randomUUID();
      const res = await fetch("/api/agent/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `case-create:${commandId.current}`,
          "X-Correlation-Id": `case-create:${commandId.current}`,
        },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), source, ceremonyType: ceremony || undefined, context: context || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) { router.push("/agent/login"); return; }
        setError(data.error ?? "Не удалось создать кейс");
        return;
      }
      router.push(`/agent/cases/${data.id}`); // сразу открываем кейс
      router.refresh();
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте снова.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        leftIcon={<Plus size={15} weight="bold" />}
        className="flex-shrink-0"
      >
        <span className="hidden sm:inline">Новый кейс</span><span className="sm:hidden">Кейс</span>
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Новый кейс"
        busy={saving}
        footer={
          <Button type="submit" form="new-case-form" size="lg" loading={saving} disabled={!valid} className="w-full">
            Создать кейс
          </Button>
        }
      >
        <form id="new-case-form" onSubmit={submit} className="flex flex-1 flex-col">
          <Field label="ФИО клиента" required>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Петров" autoComplete="name" className={inputCls} />
          </Field>
          <Field label="Телефон" required>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 912 345-67-89" type="tel" inputMode="tel" autoComplete="tel" className={inputCls} />
          </Field>

          <Field label="Тип церемонии">
            <div className="td-segmented rounded-[12px]">
              {(["кремация", "погребение"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCeremony(ceremony === c ? "" : c)}
                  data-active={ceremony === c ? "true" : undefined}
                  className="td-segment min-h-10 flex-1 capitalize"
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Источник">
            <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>

          <Field label="Комментарий">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Контекст, бюджет, пожелания…" className={`${inputCls} resize-none`} />
          </Field>

          {error && <p role="alert" className="mt-1 text-[13px] text-danger">{error}</p>}
        </form>
      </Sheet>
    </>
  );
}

const inputCls = "td-field";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="td-field-label">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}
