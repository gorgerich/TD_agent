"use client";

import { type MemorialData, type MemorialStatus } from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function MemorialBlock({
  data,
  onCommentChange,
  onGuestsChange,
  onIncludeCafeChange,
  onStatusChange,
}: {
  data: MemorialData;
  onCommentChange: (comment: string) => void;
  onGuestsChange: (value: string) => void;
  onIncludeCafeChange: (included: boolean) => void;
  onStatusChange: (status: MemorialStatus) => void;
}) {
  const showsGuests = data.status === "agent_helps" || data.status === "client_handles";

  return (
    <div className={s.card}>
      <p className={s.cardTitle}>Поминки / кафе</p>
      <p className={s.catalogSubtitle}>Отметьте, нужны ли поминки и будет ли агент помогать с подбором кафе.</p>

      <div className={s.segmentGrid}>
        {(
          [
            ["not_discussed", "Не обсуждали"],
            ["not_needed", "Не нужны"],
            ["client_handles", "Клиент сам"],
            ["agent_helps", "Нужна помощь"],
          ] as Array<[MemorialStatus, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`${s.segmentBtn} ${data.status === value ? s.segmentBtnActive : ""}`}
            onClick={() => onStatusChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {showsGuests && (
        <label className={s.blockField}>
          <span>Количество гостей</span>
          <input
            inputMode="numeric"
            placeholder="Например, 20"
            value={data.guestsCount ? String(data.guestsCount) : ""}
            onChange={(event) => onGuestsChange(event.target.value)}
          />
        </label>
      )}

      <label className={s.blockField}>
        <span>Комментарий по поминкам</span>
        <textarea
          placeholder="Например: нужно кафе рядом с кладбищем, без алкоголя, на 20 человек"
          value={data.comment ?? ""}
          onChange={(event) => onCommentChange(event.target.value)}
        />
      </label>

      {data.status === "agent_helps" && (
        <label className={s.inlineCheck}>
          <input
            type="checkbox"
            checked={Boolean(data.includeCafeAssistance)}
            onChange={(event) => onIncludeCafeChange(event.target.checked)}
          />
          <span>Добавить помощь с кафе в смету</span>
        </label>
      )}

      {data.status === "agent_helps" && (
        <div className={s.helperNote}>Можно предложить клиенту несколько вариантов кафе и меню, чтобы снять с семьи отдельную задачу.</div>
      )}
      {data.status === "client_handles" && (
        <div className={s.helperNote}>Клиент организует поминки самостоятельно. Не включайте кафе в итоговую смету, если агент не помогает с подбором.</div>
      )}
    </div>
  );
}
