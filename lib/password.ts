import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;

  const [scheme, iterationsRaw, salt, expectedHash] = storedHash.split("$");
  const iterations = Number(iterationsRaw);

  if (scheme !== "pbkdf2" || !Number.isFinite(iterations) || !salt || !expectedHash) {
    return false;
  }

  const actual = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
  const expected = Buffer.from(expectedHash, "base64url");

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
