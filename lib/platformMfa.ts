import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptString, encryptString } from "@/lib/crypto";

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generatePlatformMfaSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function encryptPlatformMfaSecret(secret: string): string {
  return encryptString(secret);
}

export function decryptPlatformMfaSecret(encrypted: string): string {
  return decryptString(encrypted);
}

export function platformMfaUri(secret: string): string {
  const issuer = encodeURIComponent("Тихий дом");
  const label = encodeURIComponent("Тихий дом:Владелец платформы");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}

export function verifyPlatformMfaCode(secret: string, code: string, now = Date.now()): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const expected = Buffer.from(normalized);
  const counter = Math.floor(now / 1000 / PERIOD_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const actual = Buffer.from(totp(secret, counter + offset));
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

export function totp(secret: string, counter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS)): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (
    ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff)
  );
  return String(binary % (10 ** DIGITS)).padStart(DIGITS, "0");
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of input.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
