"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TRANSITIONS: Record<string, { label: string; next: string; cls: string }[]> = {
  SCHEDULED: [
    { label: "Начать встречу", next: "IN_PROGRESS", cls: "bg-accent text-on-accent hover:bg-accent-hover border-transparent" },
    { label: "Отменить", next: "CANCELLED", cls: "bg-surface text-ink-2 hover:bg-danger-soft hover:text-danger border-line" },
  ],
  IN_PROGRESS: [
    { label: "Завершить встречу", next: "COMPLETED", cls: "bg-success text-on-accent hover:opacity-90 border-transparent" },
    { label: "Отменить", next: "CANCELLED", cls: "bg-surface text-ink-2 hover:bg-danger-soft hover:text-danger border-line" },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

export default function MeetingActions({ meetingId, currentStatus }: { meetingId: number; currentStatus: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const transitions = TRANSITIONS[currentStatus] ?? [];

  async function changeStatus(next: string) {
    setLoading(true);
    try {
      await fetch(`/api/agent/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (transitions.length === 0) return null;

  return (
    <div className="rise rise-3 border-t border-line pt-5">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Изменить статус</p>
      <div className="flex flex-wrap gap-2.5">
        {transitions.map((t) => (
          <button
            key={t.next}
            onClick={() => changeStatus(t.next)}
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50 ${t.cls}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
