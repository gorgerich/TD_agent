"use client";

import { useState, useTransition } from "react";
import { NotePencil, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { dateTime } from "@/lib/format";
import { useToast } from "@/components/Toast";

type Note = {
  id: number;
  body: string;
  createdAt: string;
};

export function NotesSection({ caseId, initial, canMutate = true }: { caseId: number; initial: Note[]; canMutate?: boolean }) {
  const [notes, setNotes] = useState<Note[]>(initial);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [, startTransition] = useTransition();
  const toast = useToast();

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/cases/${caseId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!res.ok) {
        toast({ type: "error", message: "Не удалось сохранить заметку. Попробуйте снова." });
        return;
      }
      const { note } = await res.json();
      setNotes((prev) => [{ ...note, createdAt: new Date(note.createdAt).toISOString() }, ...prev]);
      setBody("");
      setShowForm(false);
    } catch {
      toast({ type: "error", message: "Нет связи. Заметка не сохранена." });
    } finally {
      setSaving(false);
    }
  }

  function deleteNote(id: number) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agent/cases/${caseId}/notes/${id}`, { method: "DELETE" });
        if (!res.ok) {
          toast({ type: "error", message: "Не удалось удалить заметку. Попробуйте снова." });
          return;
        }
        setNotes((prev) => prev.filter((n) => n.id !== id));
      } catch {
        toast({ type: "error", message: "Нет связи. Заметка не удалена." });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="td-work-kicker">
        <span>{notes.length > 0 ? <><strong>{notes.length}</strong> записей по кейсу</> : "Фиксируйте договорённости после каждого контакта"}</span>
      </div>

      {notes.length === 0 && !showForm && (
        <div className="td-form-surface py-5 text-center">
          <NotePencil size={22} weight="fill" className="mx-auto text-accent" />
          <p className="mt-2 text-[13px] font-medium text-ink">Заметок пока нет</p>
          <p className="mx-auto mt-1 max-w-[44ch] text-[12px] leading-relaxed text-ink-3">Запишите важную договорённость, чтобы она не осталась в памяти после встречи.</p>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="td-work-list" aria-label="Заметки по кейсу">
          {notes.map((note) => (
            <li key={note.id} className="td-work-row">
              <div className="flex min-w-0 items-start gap-3 px-1 py-3 sm:px-2">
                <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent shadow-[var(--shadow-xs)]">
                  <NotePencil size={18} weight="fill" />
                </span>
                <span className="min-w-0 flex-1 pt-0.5">
                  <span className="block whitespace-pre-line text-[13px] leading-relaxed text-ink">{note.body}</span>
                  <span className="mt-2 block text-[12px] text-ink-3">{dateTime(note.createdAt)}</span>
                </span>
                {canMutate && (
                  <button
                    type="button"
                    onClick={() => deleteNote(note.id)}
                    className="td-icon-button h-10 w-10 flex-shrink-0 text-ink-3 hover:bg-danger-soft hover:text-danger"
                    aria-label="Удалить заметку"
                  >
                    <Trash size={16} weight="bold" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canMutate && (showForm ? (
        <form onSubmit={addNote} className="td-form-surface grid gap-3" aria-label="Новая заметка">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-ink">Новая запись</span>
            <span className="text-[12px] text-ink-3">Только для агента</span>
          </div>
          <textarea
            autoFocus
            className="td-field resize-y"
            placeholder="Что согласовали, что обещали сделать, что важно не потерять"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            required
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" size="sm" loading={saving} disabled={!body.trim()}>Сохранить заметку</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>Отмена</Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" size="sm" leftIcon={<Plus size={15} weight="bold" />} onClick={() => setShowForm(true)}>
          Добавить заметку
        </Button>
      ))}
      {!canMutate && <p className="text-[12px] text-ink-3">Заметки доступны для контекста. Редактирует владелец кейса.</p>}
    </div>
  );
}

export default NotesSection;
