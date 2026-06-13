"use client";

import { useState, useTransition } from "react";
import { Trash, Plus } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Note = {
  id: number;
  body: string;
  createdAt: string;
};

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function NotesSection({ caseId, initial }: { caseId: number; initial: Note[] }) {
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
      if (!res.ok) { toast({ type: "error", message: "Не удалось сохранить заметку. Попробуйте снова." }); return; }
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
        if (!res.ok) { toast({ type: "error", message: "Не удалось удалить заметку. Попробуйте снова." }); return; }
        setNotes((prev) => prev.filter((n) => n.id !== id));
      } catch {
        toast({ type: "error", message: "Нет связи. Заметка не удалена." });
      }
    });
  }

  return (
    <div>
      {notes.length === 0 && !showForm && (
        <p className="text-[13px] text-ink-3">Нет заметок</p>
      )}
      {notes.length > 0 && (
        <ul className="mb-3 space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="group relative rounded-[12px] border border-line bg-surface-2 px-4 py-3">
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">{note.body}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-3">{fmtDate(note.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => deleteNote(note.id)}
                  className="p-1 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  aria-label="Удалить заметку"
                >
                  <Trash size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <form onSubmit={addNote} className="mt-3 space-y-2.5 rounded-[14px] border border-line bg-surface-2 p-3.5">
          <textarea
            autoFocus
            className="min-h-[80px] w-full resize-y rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            placeholder="Заметка по делу (только для агента)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            required
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !body.trim()}
              className="min-h-9 flex-1 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-on-accent disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-9 rounded-[10px] border border-line bg-surface px-4 text-[13px] font-medium text-ink-2"
            >
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
        >
          <Plus size={14} weight="bold" /> Добавить заметку
        </button>
      )}
    </div>
  );
}
