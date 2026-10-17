import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const PASSWORD_ITERATIONS = 600_000;
export const PASSWORD_MAX_VERIFY_ITERATIONS = 1_200_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;
  const actual = pbkdf2Sync(password, parsed.salt, parsed.iterations, KEY_LENGTH, DIGEST);
  return timingSafeEqual(actual, parsed.expected);
}

function parsePasswordHash(storedHash: string | null | undefined) {
  if (!storedHash || storedHash.length > 128) return null;
  const parts = storedHash.split("$");
  if (parts.length !== 4) return null;
  const [scheme, rounds, salt, encoded] = parts;
  if (scheme !== "pbkdf2" || !/^[1-9]\d{0,6}$/.test(rounds!)
    || !/^[A-Za-z0-9_-]{22}$/.test(salt!) || !/^[A-Za-z0-9_-]{43}$/.test(encoded!)) return null;
  const iterations = Number(rounds);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > PASSWORD_MAX_VERIFY_ITERATIONS) return null;
  const expected = Buffer.from(encoded!, "base64url");
  if (expected.length !== KEY_LENGTH || expected.toString("base64url") !== encoded
    || Buffer.from(salt!, "base64url").toString("base64url") !== salt) return null;
  // Existing hashes use the encoded salt text, not its decoded bytes.
  return { iterations, salt: salt!, expected };
}

export function passwordNeedsUpgrade(storedHash: string): boolean {
  const parsed = parsePasswordHash(storedHash);
  return parsed !== null && parsed.iterations < PASSWORD_ITERATIONS;
}

const DUMMY_SALT = "AAAAAAAAAAAAAAAAAAAAAA";

/** Equalize failed logins, including legacy hashes and accounts with no password. */
export function verifyPasswordForLogin(password: string, storedHash: string | null | undefined): boolean {
  const parsed = parsePasswordHash(storedHash);
  const iterations = parsed?.iterations ?? PASSWORD_MAX_VERIFY_ITERATIONS;
  const actual = pbkdf2Sync(password, parsed?.salt ?? DUMMY_SALT, iterations, KEY_LENGTH, DIGEST);
  const valid = parsed !== null && timingSafeEqual(actual, parsed.expected);
  if (!valid && iterations < PASSWORD_MAX_VERIFY_ITERATIONS) {
    pbkdf2Sync(password, DUMMY_SALT, PASSWORD_MAX_VERIFY_ITERATIONS - iterations, KEY_LENGTH, DIGEST);
  }
  return valid;
}
