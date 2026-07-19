const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function zonedLocalToIso(value: string, timezone: string): string | null {
  const match = value.match(LOCAL_DATE_TIME);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const desired = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let candidate = desired;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const represented = zonedPartsAsUtc(new Date(candidate), timezone);
    candidate += desired - represented;
  }

  const result = new Date(candidate);
  return zonedLocalInput(result.toISOString(), timezone) === value ? result.toISOString() : null;
}

export function zonedLocalInput(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = formatter(timezone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function zonedPartsAsUtc(value: Date, timezone: string): number {
  const parts = formatter(timezone).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
}

function formatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
