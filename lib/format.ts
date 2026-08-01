import { formatMinorUnitsCurrency } from "@/lib/calculationUtils";
// Единые форматтеры для всей платформы. Один источник правды —
// деньги/даты/телефон выглядят одинаково на агенте и у клиента.

const RU_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;
const RU_MONTHS_LONG = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"] as const;
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "Europe/Moscow";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function groupNumber(value: number): string {
  return String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Рубли (целые), напр. «25 000 ₽». Принимает рубли. */
export function money(rubles: number | null | undefined): string {
  const value = Number.isFinite(rubles) ? Math.round(rubles ?? 0) : 0;
  return `${value < 0 ? "−" : ""}${groupNumber(value)} ₽`;
}

/** Копейки → рубли строкой. Для значений из БД (хранятся в копейках). */
/**
 * Render a stored minor-unit amount exactly. Going through money() rounds to whole rubles,
 * which makes the registry disagree with the client view and the builder for the same
 * published version. Kopecks are shown only when they exist.
 */
export function moneyFromKopecks(kopecks: number | null | undefined): string {
  // Delegate, do not reimplement. Two hand-rolled formatters drifted on the group separator
  // (U+00A0 vs U+0020) and the minus sign, so the registry and the client view rendered the
  // same amount as different strings.
  return formatMinorUnitsCurrency(kopecks ?? 0);
}

type DateInput = Date | string | number | null | undefined;
function toDate(d: DateInput): Date | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toZonedParts(d: DateInput, timezone = DEFAULT_TIMEZONE) {
  const date = toDate(d);
  if (!date) return null;
  // Preserve deterministic legacy output while allowing organization timezones.
  if (timezone === DEFAULT_TIMEZONE) {
    const moscow = new Date(date.getTime() + MOSCOW_OFFSET_MS);
    return {
      day: moscow.getUTCDate(),
      month: moscow.getUTCMonth(),
      year: moscow.getUTCFullYear(),
      hour: moscow.getUTCHours(),
      minute: moscow.getUTCMinutes(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return {
    day: part("day"),
    month: part("month") - 1,
    year: part("year"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

/** «5 июн» */
export function dateShort(d: DateInput, timezone = DEFAULT_TIMEZONE): string {
  const value = toZonedParts(d, timezone);
  return value ? `${value.day} ${RU_MONTHS_SHORT[value.month]}` : "—";
}

/** «5 июня 2026 г.» */
export function dateLong(d: DateInput, timezone = DEFAULT_TIMEZONE): string {
  const value = toZonedParts(d, timezone);
  return value ? `${value.day} ${RU_MONTHS_LONG[value.month]} ${value.year} г.` : "—";
}

/** «14:30» */
export function time(d: DateInput, timezone = DEFAULT_TIMEZONE): string {
  const value = toZonedParts(d, timezone);
  return value ? `${pad(value.hour)}:${pad(value.minute)}` : "—";
}

/** «5 июня, 14:30» */
export function dateTime(d: DateInput, timezone = DEFAULT_TIMEZONE): string {
  const value = toZonedParts(d, timezone);
  return value ? `${value.day} ${RU_MONTHS_LONG[value.month]}, ${pad(value.hour)}:${pad(value.minute)}` : "—";
}

/** Маска телефона РФ: «+7 (916) 123-45-67». Без потери исходных данных при пустом. */
export function phone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "").replace(/^8/, "7");
  if (digits.length !== 11 || digits[0] !== "7") return raw;
  return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}
