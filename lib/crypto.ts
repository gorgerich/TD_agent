import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { requireAppEncryptionKey } from "./session";

/**
 * Симметричное шифрование строк для ПДн «на уровне приложения» (ФЗ-152):
 * AES-256-GCM. Ключ выводится из APP_ENCRYPTION_KEY (sha256 → 32 байта).
 * Формат: base64(iv).base64(tag).base64(ciphertext), префикс "enc1:".
 *
 * Используется для AgentSession.state (co-browse состояние со сведениями
 * об усопшем/клиенте). Node-only (node:crypto).
 */

const PREFIX = "enc1:";
const IV_LEN = 12;

export class EncryptedDataUnavailableError extends Error {
  readonly code = "PII_DECRYPTION_UNAVAILABLE";

  constructor() {
    super("Encrypted personal data is unavailable");
    this.name = "EncryptedDataUnavailableError";
  }
}

function getKey({ allowMissing = false }: { allowMissing?: boolean } = {}): Buffer | null {
  let secret: string;
  try {
    secret = requireAppEncryptionKey();
  } catch {
    if (allowMissing) return null;
    throw new EncryptedDataUnavailableError();
  }
  return createHash("sha256").update(secret).digest();
}

/** Шифрует строку. Возвращает "enc1:iv.tag.ciphertext" (всё base64). */
export function encryptString(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const key = getKey();
  if (!key) throw new Error("APP_ENCRYPTION_KEY must be set in production");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

/**
 * Расшифровывает строку. Обратная совместимость: если строка не в формате
 * "enc1:" (легаси-плейнтекст в БД) — возвращает её как есть.
 */
export function decryptString(stored: string): string {
  return decryptStoredString(stored, false);
}

/** Strict PII read: never converts a missing/wrong key or damaged ciphertext into blank data. */
export function decryptStringStrict(stored: string): string {
  return decryptStoredString(stored, true);
}

function decryptStoredString(stored: string, strict: boolean): string {
  if (!stored.startsWith(PREFIX)) return stored; // легаси-плейнтекст
  const parts = stored.slice(PREFIX.length).split(".");
  const [ivB64, tagB64, ctB64] = parts;
  if (parts.length !== 3 || !ivB64 || !tagB64 || ctB64 === undefined) {
    if (strict) throw new EncryptedDataUnavailableError();
    throw new Error("Повреждённый шифртекст");
  }
  const key = getKey({ allowMissing: true });
  // Если prod env ещё не получил APP_ENCRYPTION_KEY, не роняем MVP-экраны.
  // Зашифрованное ПДн без ключа не показываем.
  if (!key) {
    if (strict) throw new EncryptedDataUnavailableError();
    return "";
  }
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");
    if (iv.length !== IV_LEN || tag.length !== 16 || iv.toString("base64") !== ivB64
      || tag.toString("base64") !== tagB64 || ciphertext.toString("base64") !== ctB64) {
      throw new EncryptedDataUnavailableError();
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    if (strict) throw new EncryptedDataUnavailableError();
    // Старые demo-данные могли быть зашифрованы другим ключом после сброса env.
    // Не показываем ciphertext и не роняем рабочие экраны.
    return "";
  }
}

/** Шифрование nullable-поля ПДн для записи в БД. null/"" — без изменений. */
export function encryptField<T extends string | null | undefined>(v: T): T {
  return (v == null || v === "" ? v : (encryptString(v) as T));
}

/** Расшифровка nullable-поля ПДн при чтении. null — без изменений; легаси-плейнтекст проходит насквозь. */
export function decryptField<T extends string | null | undefined>(v: T): T {
  return (v == null ? v : (decryptString(v) as T));
}

/** Strict nullable PII read. Legacy plaintext passes through; encrypted failures are explicit. */
export function decryptFieldStrict<T extends string | null | undefined>(v: T): T {
  return (v == null ? v : (decryptStringStrict(v) as T));
}
