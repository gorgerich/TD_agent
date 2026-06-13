// Операционный статус кейса — главный сдвиг логики платформы (v3).
//
// Раньше кейс описывался существительным-этапом (Лид/Смета/Договор) — агент не
// понимал, ЧЕГО ждём и что делать. Теперь статус операционный: «Смета отправлена»,
// «Ожидаем клиента», «Ожидаем оплату», «Церемония запланирована». Выводится из
// существующих данных, без новых таблиц и миграций.
//
// stageIdx 0..5 сохраняет совместимость с линейным степпером STAGE_ORDER (lib/case.ts).

import type { Stage } from "./case";
import { STAGE_ORDER } from "./case";

export type StatusTone = "neutral" | "info" | "accent" | "warning" | "success" | "danger";
export type WaitingOn = "client" | "payment" | "docs" | "info" | null;

export type CaseStatus = {
  /** Стабильный ключ для группировки/сортировки. */
  key: string;
  /** Операционная подпись для агента. */
  label: string;
  tone: StatusTone;
  /** Следующее действие — описывает ИСХОД, не «продолжить». */
  next: string;
  /** Индекс в линейном маршруте (0..5) для степпера. */
  stageIdx: number;
  /** Чего ждём (для дашборд-бакетов). */
  waiting: WaitingOn;
};

export type CaseStatusInput = {
  meetingsLen: number;
  /** Есть ли назначенная встреча в будущем. */
  hasUpcomingMeeting?: boolean;
  quotesLen: number;
  orders: { status: string }[];
  /** Сгенерён ли код клиентской ссылки (смету можно показать). */
  hasCobrowse?: boolean;
  /** Клиент открывал /co. */
  clientViewed?: boolean;
  /** Клиент нажал «Согласовать». */
  clientAgreed?: boolean;
  /** Обязательный минимум документов собран. */
  docsComplete?: boolean;
  /** Заполнен ли интейк (усопший + формат) — достаточно для сметы. */
  intakeComplete?: boolean;
  /** Дедлайн церемонии (мс) и текущее время (мс). */
  ceremonyAt?: number | null;
  nowMs?: number;
};

const PAID = new Set(["PAID", "COMPLETED"]);
const PARTIAL = new Set(["PARTIALLY_PAID"]);
const OPEN_ORDER = new Set(["PENDING", "SIGNED", "IN_PROCESS"]);

/** Статус кейса = что сейчас происходит и что делать дальше. */
export function deriveCaseStatus(input: CaseStatusInput): CaseStatus {
  const {
    meetingsLen,
    hasUpcomingMeeting = false,
    quotesLen,
    orders,
    hasCobrowse = false,
    clientViewed = false,
    clientAgreed = false,
    docsComplete = false,
    intakeComplete = true,
    ceremonyAt = null,
    nowMs = Date.now(),
  } = input;

  const statuses = orders.map((o) => o.status.toUpperCase());
  const isPaid = statuses.some((s) => PAID.has(s));
  const isPartial = statuses.some((s) => PARTIAL.has(s));
  const hasOpenOrder = statuses.some((s) => OPEN_ORDER.has(s));
  const isCompleted = statuses.includes("COMPLETED");
  const ceremonyScheduled = ceremonyAt != null && ceremonyAt > nowMs;

  // ── Завершение ──────────────────────────────────────────────
  if (isCompleted) {
    return mk("done", "Кейс завершён", "success", "Кейс закрыт. История сохранена.", 5, null);
  }

  // ── Оплата получена → логистика церемонии ───────────────────
  if (isPaid) {
    if (ceremonyScheduled) {
      return mk("ceremony-scheduled", "Церемония запланирована", "accent",
        "Подготовьте логистику: транспорт, зал, кладбище.", 4, null);
    }
    return mk("paid", "Оплачено", "success",
      "Согласуйте дату и время церемонии с семьёй.", 4, null);
  }

  // ── Аванс получен → ждём остаток ────────────────────────────
  if (isPartial) {
    return mk("deposit", "Аванс получен", "info",
      "Примите остаток оплаты по договорённости.", 4, "payment");
  }

  // ── Есть открытый заказ / договор, но не оплачен ────────────
  if (hasOpenOrder) {
    return mk("await-payment", "Ожидаем оплату", "warning",
      "Примите аванс или полную оплату.", 3, "payment");
  }

  // ── Клиент согласовал смету (но договора ещё нет) ───────────
  if (clientAgreed) {
    return mk("client-agreed", "Клиент согласовал смету", "success",
      "Оформите договор и примите оплату.", 3, null);
  }

  // ── Смета есть ──────────────────────────────────────────────
  if (quotesLen > 0) {
    if (!hasCobrowse) {
      return mk("quote-ready", "Смета готова", "info",
        "Отправьте смету клиенту по ссылке.", 2, null);
    }
    if (clientViewed) {
      return mk("client-viewing", "Клиент смотрит смету", "info",
        "Свяжитесь с клиентом, ответьте на вопросы.", 2, "client");
    }
    return mk("quote-sent", "Смета отправлена", "info",
      "Ждём реакцию клиента — при паузе напомните.", 2, "client");
  }

  // ── Встреча есть, сметы нет ─────────────────────────────────
  if (meetingsLen > 0) {
    if (!intakeComplete) {
      return mk("collecting-info", "Собираем информацию", "neutral",
        "Заполните данные семьи и усопшего.", 1, "info");
    }
    if (!docsComplete) {
      return mk("preparing", "Готовим смету и документы", "neutral",
        "Соберите смету, начните сбор документов.", 1, "docs");
    }
    return mk("preparing", "Готовим смету", "neutral",
      "Соберите смету по потребностям семьи.", 1, null);
  }

  // ── Новый кейс ──────────────────────────────────────────────
  if (hasUpcomingMeeting) {
    return mk("meeting-set", "Встреча назначена", "neutral",
      "Проведите встречу и соберите вводные.", 0, null);
  }
  return mk("new", "Новый кейс", "neutral",
    "Назначьте встречу и заполните вводные по семье.", 0, "info");
}

function mk(
  key: string, label: string, tone: StatusTone, next: string, stageIdx: number, waiting: WaitingOn,
): CaseStatus {
  return { key, label, tone, next, stageIdx, waiting };
}

/** Этап-существительное (для степпера) из stageIdx статуса. */
export function statusStage(status: CaseStatus): Stage {
  return STAGE_ORDER[status.stageIdx] ?? STAGE_ORDER[0];
}
