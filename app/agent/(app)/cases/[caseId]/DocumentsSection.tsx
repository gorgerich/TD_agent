"use client";

import { useRef, useState, useTransition } from "react";
import { FilePdf, FileImage, FileArrowUp, Trash, ArrowSquareOut } from "@phosphor-icons/react";

type Doc = {
  id: number;
  name: string;
  category: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

const CATEGORIES = ["Свидетельство о смерти", "Паспорт", "Договор", "Доверенность", "Прочее"] as const;

function fmtSize(b: number) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1)} МБ`;
}
function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function DocumentsSection({ caseId, initial }: { caseId: number; initial: Doc[] }) {
  const [docs, setDocs] = useState<Doc[]>(initial);
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      const res = await fetch(`/api/agent/cases/${caseId}/documents`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Не удалось загрузить");
        return;
      }
      setDocs((prev) => [{ ...data.document, createdAt: new Date(data.document.createdAt).toISOString() }, ...prev]);
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function remove(id: number) {
    startTransition(async () => {
      const res = await fetch(`/api/agent/cases/${caseId}/documents/${id}`, { method: "DELETE" });
      if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
    });
  }

  return (
    <div>
      {docs.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">Документов пока нет</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {docs.map((d) => {
            const isPdf = d.mimeType === "application/pdf";
            return (
              <li key={d.id} className="group flex items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-3 py-2.5">
                <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-[10px] bg-surface text-ink-2 ring-1 ring-line">
                  {isPdf ? <FilePdf size={18} weight="duotone" className="text-danger" /> : <FileImage size={18} weight="duotone" className="text-info" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{d.name}</span>
                  <span className="block text-[11.5px] text-ink-3">{d.category} · {fmtSize(d.size)} · {fmtDate(d.createdAt)}</span>
                </span>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener"
                  className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[9px] text-ink-3 transition-colors hover:bg-surface hover:text-accent"
                  aria-label="Открыть документ"
                >
                  <ArrowSquareOut size={16} />
                </a>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[9px] text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  aria-label="Удалить документ"
                >
                  <Trash size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="min-h-9 rounded-[10px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" onChange={onPick} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[12.5px] font-semibold text-on-accent shadow-[0_1px_2px_rgba(20,30,24,0.2),inset_0_1px_0_rgba(255,255,255,0.14)] transition-colors hover:bg-accent-hover disabled:opacity-55"
        >
          <FileArrowUp size={15} weight="bold" /> {busy ? "Загружаю…" : "Загрузить"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
      <p className="mt-2 text-[11.5px] text-ink-3">PDF, JPG, PNG · до 10 МБ</p>
    </div>
  );
}

export default DocumentsSection;
