"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TRANSITIONS: Record<string, { label: string; next: string; cls: string }[]> = {
  SCHEDULED: [
    { label: "Начать встречу", next: "IN_PROGRESS", cls: "bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-600/30" },
    { label: "Отменить", next: "CANCELLED", cls: "bg-white/[0.04] hover:bg-white/[0.07] text-slate-500 border-white/[0.08]" },
  ],
  IN_PROGRESS: [
    { label: "Завершить встречу", next: "COMPLETED", cls: "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-600/30" },
    { label: "Отменить", next: "CANCELLED", cls: "bg-white/[0.04] hover:bg-white/[0.07] text-slate-500 border-white/[0.08]" },
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
    <div className="border-t border-white/[0.06] pt-5">
      <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 mb-3">Изменить статус</p>
      <div className="flex gap-2">
        {transitions.map((t) => (
          <button
            key={t.next}
            onClick={() => changeStatus(t.next)}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold rounded-lg border transition-all disabled:opacity-50 ${t.cls}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
