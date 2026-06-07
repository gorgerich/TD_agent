import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

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

function getKey({ allowMissing = false }: { allowMissing?: boolean } = {}): Buffer | null {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production" && !secret) {
    if (allowMissing) return null;
    throw new Error("APP_ENCRYPTION_KEY must be set in production");
  }
  return createHash("sha256")
    .update(secret ?? "dev-key-tihiydom-not-for-production-ok")
    .digest();
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
  if (!stored.startsWith(PREFIX)) return stored; // легаси-плейнтекст
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Повреждённый шифртекст");
  const key = getKey({ allowMissing: true });
  // Если prod env ещё не получил APP_ENCRYPTION_KEY, не роняем MVP-экраны.
  // Зашифрованное ПДн без ключа не показываем.
  if (!key) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
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
