"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { useSwipeX } from "@/lib/useSwipeX";

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
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const closingRef = useRef(false);

  // Drag-to-close: панель тянется вправо за пальцем, флик или 140px - закрытие.
  // Поля ввода жест не перехватывают (ignore по умолчанию в хуке).
  const swipe = useSwipeX({
    dir: "right",
    threshold: 140,
    velocity: 0.5,
    enabled: open && !saving,
    onCommit: () => close(),
  });

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closingRef.current = false;
      swipe.reset();
    }, 220);
  }

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {open && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000 }}
          role="dialog"
          aria-modal="true"
          aria-label="Новый кейс"
        >
          <div
            className="absolute inset-0 bg-[rgba(10,18,32,0.45)]"
            style={{
              animation: closing ? undefined : "overlayFade 0.2s ease-out",
              opacity: closing ? 0 : 1 - swipe.progress * 0.4,
              transition: swipe.dragging ? "none" : "opacity 0.2s ease-out",
            }}
            onClick={close}
          />
          <div
            {...swipe.bind}
            className="absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col bg-surface shadow-pop"
            style={{
              animation: closing ? undefined : "sheetInRight 0.36s var(--ease-drawer)",
              transform: closing
                ? "translateX(100%)"
                : swipe.dx > 0
                ? `translateX(${swipe.dx}px)`
                : undefined,
              transition: swipe.dragging ? "none" : "transform 0.26s var(--ease-drawer)",
              touchAction: "pan-y",
            }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="td-display text-[20px] text-ink">Новый кейс</h2>
              <button type="button" onClick={close} aria-label="Закрыть" className="td-icon-button h-9 w-9">
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

              {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}

              <div className="mt-auto pt-3">
                <Button type="submit" size="lg" loading={saving} disabled={!valid} className="w-full">
                  Создать кейс
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const inputCls =
  "min-h-12 w-full rounded-[12px] border border-line bg-surface px-3.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] focus:border-accent focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_3px_rgba(0,58,53,0.14)]";

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
