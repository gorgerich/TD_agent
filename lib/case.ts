// Единая модель «дела» (case). «Дело» = клиент + его встречи/сметы/заказы.
// Этап выводится из самого продвинутого артефакта — без отдельной таблицы.

export type Stage = "Лид" | "Документы" | "Смета" | "Договор" | "Оплата" | "Завершено";

export const STAGE_ORDER: Stage[] = ["Лид", "Документы", "Смета", "Договор", "Оплата", "Завершено"];

export const STAGE_DOT: Record<Stage, string> = {
  Лид: "bg-ink-3",
  Документы: "bg-info",
  Смета: "bg-warning",
  Договор: "bg-accent",
  Оплата: "bg-accent",
  Завершено: "bg-success",
};

export const NEXT_ACTION: Record<Stage, string> = {
  Лид: "Назначить встречу",
  Документы: "Собрать документы и смету",
  Смета: "Отправить смету клиенту",
  Договор: "Подписать договор",
  Оплата: "Принять оплату",
  Завершено: "Дело завершено",
};

export function deriveStage(orders: { status: string }[], quotesLen: number, meetingsLen: number): Stage {
  const st = orders.map((o) => o.status.toUpperCase());
  if (st.includes("COMPLETED")) return "Завершено";
  if (st.some((s) => s === "PAID" || s === "PARTIALLY_PAID")) return "Оплата";
  if (orders.length > 0) return "Договор";
  if (quotesLen > 0) return "Смета";
  if (meetingsLen > 0) return "Документы";
  return "Лид";
}

export function stageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** Относительное время «14 мин назад» (ts и now в мс). */
export function relTime(ts: number, now: number): string {
  const min = Math.round((now - ts) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} дн назад`;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(ts));
}
