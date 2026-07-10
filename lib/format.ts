// Единые форматтеры для всей платформы. Один источник правды —
// деньги/даты/телефон выглядят одинаково на агенте и у клиента.

const RU_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;
const RU_MONTHS_LONG = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"] as const;
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

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
export function moneyFromKopecks(kopecks: number | null | undefined): string {
  return money((kopecks ?? 0) / 100);
}

type DateInput = Date | string | number | null | undefined;
function toDate(d: DateInput): Date | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMoscowParts(d: DateInput) {
  const date = toDate(d);
  if (!date) return null;
  // Moscow stays UTC+3 year-round. Manual parts avoid Node/browser Intl punctuation differences during hydration.
  const moscow = new Date(date.getTime() + MOSCOW_OFFSET_MS);
  return {
    day: moscow.getUTCDate(),
    month: moscow.getUTCMonth(),
    year: moscow.getUTCFullYear(),
    hour: moscow.getUTCHours(),
    minute: moscow.getUTCMinutes(),
  };
}

/** «5 июн» */
export function dateShort(d: DateInput): string {
  const value = toMoscowParts(d);
  return value ? `${value.day} ${RU_MONTHS_SHORT[value.month]}` : "—";
}

/** «5 июня 2026 г.» */
export function dateLong(d: DateInput): string {
  const value = toMoscowParts(d);
  return value ? `${value.day} ${RU_MONTHS_LONG[value.month]} ${value.year} г.` : "—";
}

/** «14:30» */
export function time(d: DateInput): string {
  const value = toMoscowParts(d);
  return value ? `${pad(value.hour)}:${pad(value.minute)}` : "—";
}

/** «5 июня, 14:30» */
export function dateTime(d: DateInput): string {
  const value = toMoscowParts(d);
  return value ? `${value.day} ${RU_MONTHS_LONG[value.month]}, ${pad(value.hour)}:${pad(value.minute)}` : "—";
}

/** Маска телефона РФ: «+7 (916) 123-45-67». Без потери исходных данных при пустом. */
export function phone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "").replace(/^8/, "7");
  if (digits.length !== 11 || digits[0] !== "7") return raw;
  return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}
