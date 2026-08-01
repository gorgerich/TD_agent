import { NextResponse } from "next/server";

/**
 * Лёгкий in-memory rate limiter (фиксированное окно) для защиты auth-роутов
 * от перебора. ВАЖНО: на Vercel serverless память не общая между инстансами —
 * лимит работает best-effort (per-instance). Для боевой защиты от распределённого
 * перебора подключить Upstash/Redis (см. TODO ниже). Лучше, чем ничего.
 */

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

// Периодическая очистка протухших ключей (не растим память бесконечно).
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of store) {
    if (b.resetAt <= now) store.delete(k);
  }
}

export type RateResult = { ok: boolean; remaining: number; retryAfter: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now);
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: limit - bucket.count, retryAfter: 0 };
}

/** Клиентский IP из заголовков прокси (Vercel ставит x-forwarded-for). */
export function clientIp(req: Request): string {
  // Hop headers are only trustworthy behind a proxy that overwrites them — true on the
  // Vercel deployment, false for a bare `next start`. Collapsing to one shared bucket when
  // that cannot be proven was tried and rejected: it throttles unrelated tenants against
  // each other. The residual exposure is recorded as an accepted P2 in the M2 evidence —
  // it predates this mission, and token entropy keeps it to abuse of an already-known link
  // rather than discovery.
  // x-forwarded-for is a caller-appendable list, and taking its LEFTMOST entry let any
  // client choose its own rate-limit bucket — which matters now that the public
  // client-link routes sit behind this limiter. Fall back to the RIGHTMOST forwarded hop,
  // which is the one the closest trusted proxy appended.
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}

/**
 * Применяет лимит и, при превышении, возвращает готовый 429-ответ (иначе null).
 * Использование: `const limited = enforceRateLimit(req, "login", 10, 60_000); if (limited) return limited;`
 */
export function enforceRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const { ok, retryAfter } = rateLimit(`${bucket}:${clientIp(req)}`, limit, windowMs);
  if (ok) return null;
  return NextResponse.json(
    { error: "Слишком много попыток. Повторите позже." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
