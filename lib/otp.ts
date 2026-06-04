import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * OTP-коды для SMS-входа агента. Сам код в БД НЕ хранится — только
 * sha256(code + phone + secret) (см. OtpToken.codeHash, ФЗ-152). Node-only.
 */

const CODE_LEN = 6;
const TTL_MS = 5 * 60 * 1000; // 5 минут

/** Каноничный вид телефона РФ: только цифры, ведущая 8→7, формат +7XXXXXXXXXX. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^8/, "7");
  return digits.length === 11 && digits[0] === "7" ? `+${digits}` : `+${digits}`;
}

/** 6-значный код, равномерно случайный (crypto). */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, "0");
}

function secret(): string {
  const s = process.env.APP_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production" && !s) {
    throw new Error("APP_ENCRYPTION_KEY must be set in production");
  }
  return s ?? "dev-key-tihiydom-not-for-production-ok";
}

/** Хэш кода, привязанный к телефону (нельзя переиспользовать на другой номер). */
export function hashOtp(code: string, phone: string): string {
  return createHash("sha256").update(`${code}:${normalizePhone(phone)}:${secret()}`).digest("hex");
}

/** Сравнение хэшей в постоянное время. */
export function verifyOtp(code: string, phone: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const actual = Buffer.from(hashOtp(code, phone), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function otpExpiry(now = Date.now()): Date {
  return new Date(now + TTL_MS);
}
