"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

const TRANSITIONS: Record<string, { label: string; next: string; variant: "primary" | "secondary"; className?: string }[]> = {
  SCHEDULED: [
    { label: "Начать встречу", next: "IN_PROGRESS", variant: "primary" },
    { label: "Отменить", next: "CANCELLED", variant: "secondary", className: "hover:bg-danger-soft hover:text-danger" },
  ],
  IN_PROGRESS: [
    { label: "Завершить встречу", next: "COMPLETED", variant: "primary" },
    { label: "Отменить", next: "CANCELLED", variant: "secondary", className: "hover:bg-danger-soft hover:text-danger" },
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
      <p className="mb-1 text-[13px] font-semibold text-ink">Статус встречи</p>
      <p className="mb-3 text-[12px] text-ink-3">Зафиксируйте этап, когда разговор действительно начался или завершился.</p>
      <div className="flex flex-wrap gap-2.5">
        {transitions.map((t) => (
          <Button
            key={t.next}
            type="button"
            onClick={() => changeStatus(t.next)}
            disabled={loading}
            variant={t.variant}
            size="sm"
            className={t.className}
          >
            {loading ? "Сохраняю..." : t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
