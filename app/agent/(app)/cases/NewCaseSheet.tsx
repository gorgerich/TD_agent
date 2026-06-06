"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "@phosphor-icons/react";

const SOURCES = [
  { value: "agent", label: "Агент" },
  { value: "telegram", label: "Telegram" },
  { value: "call", label: "Звонок" },
  { value: "site", label: "Сайт" },
  { value: "other", label: "Другое" },
];

// Создание кейса за 30–60 сек: правый sheet поверх списка дел. Минимум полей.
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
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const valid = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const context = [ceremony ? `Тип: ${ceremony}.` : "", comment.trim()].filter(Boolean).join(" ");
    try {
      const res = await fetch("/api/agent/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), source, context: context || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Не удалось создать кейс");
        return;
      }
      router.push(`/agent/cases/${data.id}`); // сразу открываем кейс
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 flex-shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors duration-200 hover:bg-accent-hover"
      >
        <Plus size={15} weight="bold" /> <span className="hidden sm:inline">Новый кейс</span><span className="sm:hidden">Кейс</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-label="Новый кейс">
          <div className="absolute inset-0 bg-[rgba(22,22,22,0.4)]" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col bg-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-serif text-[20px] text-ink">Новый кейс</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submit} className="flex flex-1 flex-col overflow-y-auto px-5 py-5">
              <Field label="ФИО клиента" required>
                <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Петров" autoComplete="name" className={inputCls} />
              </Field>
              <Field label="Телефон" required>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 912 345-67-89" type="tel" inputMode="tel" autoComplete="tel" className={inputCls} />
              </Field>

              <Field label="Тип церемонии">
                <div className="grid grid-cols-2 gap-2">
                  {(["кремация", "погребение"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCeremony(ceremony === c ? "" : c)}
                      className={`min-h-11 rounded-[12px] border text-[13.5px] font-medium capitalize transition-colors ${
                        ceremony === c ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong"
                      }`}
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

              {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}

              <div className="mt-auto pt-3">
                <button
                  type="submit"
                  disabled={!valid || saving}
                  className="flex min-h-12 w-full items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
                >
                  {saving ? "Создаю…" : "Создать кейс"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls =
  "min-h-12 w-full rounded-[12px] border border-line bg-surface px-3.5 text-[14.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[12px] font-medium text-ink-2">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}
