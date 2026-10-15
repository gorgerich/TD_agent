"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";

export function RescanDocumentButton({ leadId, versionId }: { leadId: number; versionId: string }) {
  const router = useRouter();
  const commandId = useRef<string | null>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    commandId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/cases/${leadId}/documents/${versionId}/rescan`, {
        method: "POST", headers: { "Idempotency-Key": `document-rescan:${commandId.current}`, "X-Correlation-Id": commandId.current },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status < 500) commandId.current = null;
        throw new Error(result?.error ?? "Повтор сканирования не выполнен");
      }
      if (!result?.versionId || typeof result.replayed !== "boolean") {
        throw new Error("Результат не подтверждён; повторите запрос");
      }
      commandId.current = null;
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Результат не подтверждён; повторите запрос");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <div className="min-w-0">
    <Button type="button" variant="ghost" size="sm" loading={busy} disabled={busy} onClick={retry}>
      <ArrowClockwise size={14} /> Повторить сканирование
    </Button>
    {error && <p role="alert" className="mt-2 max-w-[36ch] text-[12px] text-danger">{error}</p>}
  </div>;
}
