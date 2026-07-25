"use client";

import { useRef, useState, useTransition } from "react";
import {
  ArrowSquareOut,
  CheckCircle,
  FileArrowUp,
  FileImage,
  FilePdf,
  Files,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";
import { dateLong } from "@/lib/format";

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

const REQUIRED_DOCUMENTS = [
  {
    category: "Свидетельство о смерти",
    title: "Свидетельство о смерти",
    hint: "Нужно для договора и запуска оформления.",
  },
  {
    category: "Паспорт",
    title: "Паспорт заявителя",
    hint: "Проверка данных плательщика и договора.",
  },
  {
    category: "Договор",
    title: "Договор",
    hint: "Фиксирует состав услуг и оплату.",
  },
  {
    category: "Доверенность",
    title: "Доверенность",
    hint: "Нужна, если агент действует от имени семьи.",
  },
] as const;

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function DocumentsSection({ caseId, initial, timezone, canMutate = true }: { caseId: number; initial: Doc[]; timezone: string; canMutate?: boolean }) {
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
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);
      const res = await fetch(`/api/agent/cases/${caseId}/documents`, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Не удалось загрузить файл. Попробуйте снова.");
        return;
      }
      setDocs((prev) => [{ ...data.document, createdAt: new Date(data.document.createdAt).toISOString() }, ...prev]);
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function remove(id: number) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agent/cases/${caseId}/documents/${id}`, { method: "DELETE" });
        if (res.ok) {
          setDocs((prev) => prev.filter((doc) => doc.id !== id));
          setError(null);
          return;
        }
        setError("Не удалось удалить файл. Попробуйте снова.");
      } catch {
        setError("Нет связи. Файл не удалён.");
      }
    });
  }

  const docsByCategory = new Map<string, Doc>();
  for (const doc of docs) {
    if (!docsByCategory.has(doc.category)) docsByCategory.set(doc.category, doc);
  }
  const readyCount = REQUIRED_DOCUMENTS.filter((item) => docsByCategory.has(item.category)).length;
  const primaryDocumentIds = new Set([...docsByCategory.values()].map((doc) => doc.id));
  const extraDocs = docs.filter((doc) => !primaryDocumentIds.has(doc.id));

  return (
    <div className="space-y-5">
      <div className="td-work-kicker">
        <span><strong>{readyCount} из {REQUIRED_DOCUMENTS.length}</strong> обязательных документов готовы</span>
        {readyCount < REQUIRED_DOCUMENTS.length && <span className="font-semibold text-warning">Нужно собрать ещё {REQUIRED_DOCUMENTS.length - readyCount}</span>}
      </div>

      {canMutate && <div className="td-upload-surface">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent shadow-[var(--shadow-xs)]">
            <FileArrowUp size={19} weight="fill" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-ink">Добавить документ</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">Выберите тип, затем файл. Он сразу попадёт в историю кейса.</span>
          </span>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="min-w-0">
            <span className="sr-only">Тип документа</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="td-field">
              {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" onChange={onPick} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className={buttonClasses({ size: "sm", className: "w-full sm:w-auto" })}
          >
            <FileArrowUp size={15} weight="bold" /> {busy ? "Загружаю..." : "Выбрать файл"}
          </button>
        </div>
        <p className="text-[12px] text-ink-3">PDF, JPG, PNG - до 10 МБ</p>
      </div>}

      {error && <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p>}

      <section aria-label="Обязательные документы">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-[13px] font-semibold text-ink">Обязательные документы</h4>
          <span className="tnum text-[12px] text-ink-3">{readyCount}/{REQUIRED_DOCUMENTS.length}</span>
        </div>
        <ul className="td-work-list">
          {REQUIRED_DOCUMENTS.map((item) => {
            const uploaded = docsByCategory.get(item.category);
            return (
              <li key={item.category} className="td-work-row">
                <div className="flex min-w-0 items-center gap-3 px-1 py-2.5 sm:px-2">
                  <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] shadow-[var(--shadow-xs)] ${uploaded ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
                    {uploaded ? <CheckCircle size={19} weight="fill" /> : <WarningCircle size={19} weight="fill" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{item.title}</span>
                    <span className="mt-1 block truncate text-[12px] text-ink-3">
                      {uploaded ? `${uploaded.name} - ${fmtSize(uploaded.size)} - ${dateLong(uploaded.createdAt, timezone)}` : item.hint}
                    </span>
                  </span>
                  {uploaded ? (
                    <span className="flex flex-shrink-0 items-center gap-1">
                      <a href={uploaded.url} target="_blank" rel="noopener" className="td-icon-button h-10 w-10" aria-label={`Открыть ${item.title}`}>
                        <ArrowSquareOut size={17} weight="bold" />
                      </a>
                      {canMutate && (
                        <button type="button" onClick={() => remove(uploaded.id)} className="td-icon-button h-10 w-10 hover:bg-danger-soft hover:text-danger" aria-label={`Удалить ${item.title}`}>
                          <Trash size={16} weight="bold" />
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="flex-shrink-0 text-[12px] font-semibold text-warning">Нужно</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {extraDocs.length > 0 && (
        <section aria-label="Другие файлы">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-[13px] font-semibold text-ink">Другие файлы</h4>
            <span className="tnum text-[12px] text-ink-3">{extraDocs.length}</span>
          </div>
          <ul className="td-work-list">
            {extraDocs.map((doc) => {
              const isPdf = doc.mimeType === "application/pdf";
              return (
                <li key={doc.id} className="td-work-row">
                  <div className="flex min-w-0 items-center gap-3 px-1 py-2.5 sm:px-2">
                    <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-surface-2 text-ink-2 shadow-[var(--shadow-xs)]">
                      {isPdf ? <FilePdf size={20} weight="fill" className="text-danger" /> : <FileImage size={20} weight="fill" className="text-info" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">{doc.name}</span>
                      <span className="mt-1 block truncate text-[12px] text-ink-3">{doc.category} - {fmtSize(doc.size)} - {dateLong(doc.createdAt, timezone)}</span>
                    </span>
                    <a href={doc.url} target="_blank" rel="noopener" className="td-icon-button h-10 w-10 flex-shrink-0" aria-label={`Открыть ${doc.name}`}>
                      <ArrowSquareOut size={17} weight="bold" />
                    </a>
                    {canMutate && (
                      <button type="button" onClick={() => remove(doc.id)} className="td-icon-button h-10 w-10 flex-shrink-0 hover:bg-danger-soft hover:text-danger" aria-label={`Удалить ${doc.name}`}>
                        <Trash size={16} weight="bold" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {docs.length === 0 && (
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <Files size={15} weight="fill" /> Начните с документа, который сейчас есть у клиента.
        </div>
      )}
      {!canMutate && <p className="text-[12px] text-ink-3">Документы доступны для просмотра. Загружает и удаляет их владелец кейса.</p>}
    </div>
  );
}

export default DocumentsSection;
