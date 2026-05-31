// Единые форматтеры для всей платформы. Один источник правды —
// деньги/даты/телефон выглядят одинаково на агенте и у клиента.

const RUB = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

/** Рубли (целые), напр. «25 000 ₽». Принимает рубли. */
export function money(rubles: number | null | undefined): string {
  return RUB.format(Math.round(rubles ?? 0));
}

/** Копейки → рубли строкой. Для значений из БД (хранятся в копейках). */
export function moneyFromKopecks(kopecks: number | null | undefined): string {
  return money((kopecks ?? 0) / 100);
}

const D_SHORT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const D_LONG = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const D_TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const D_DATETIME = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

type DateInput = Date | string | number | null | undefined;
function toDate(d: DateInput): Date | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «5 июн» */
export function dateShort(d: DateInput): string {
  const date = toDate(d);
  return date ? D_SHORT.format(date) : "—";
}

/** «5 июня 2026 г.» */
export function dateLong(d: DateInput): string {
  const date = toDate(d);
  return date ? D_LONG.format(date) : "—";
}

/** «14:30» */
export function time(d: DateInput): string {
  const date = toDate(d);
  return date ? D_TIME.format(date) : "—";
}

/** «5 июня, 14:30» */
export function dateTime(d: DateInput): string {
  const date = toDate(d);
  return date ? D_DATETIME.format(date) : "—";
}

/** Маска телефона РФ: «+7 (916) 123-45-67». Без потери исходных данных при пустом. */
export function phone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "").replace(/^8/, "7");
  if (digits.length !== 11 || digits[0] !== "7") return raw;
  return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}
