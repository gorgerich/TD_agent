"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PresentationControls({ presentationId, quoteId }: { presentationId: string; quoteId: number }) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function endPresentation() {
    setEnding(true);
    setError(null);
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/presentations/${presentationId}`, {
        method: "POST",
        headers: { "Idempotency-Key": requestId, "X-Correlation-Id": requestId },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось завершить показ");
      router.push(`/agent/estimates?quote=${quoteId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось завершить показ");
      setEnding(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void endPresentation()}
        disabled={ending}
        className="min-h-11 rounded-[var(--radius-control)] bg-accent px-5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {ending ? "Завершаю..." : "Завершить показ"}
      </button>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
