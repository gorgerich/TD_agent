import type { Role } from "./auth";

export const SESSION_COOKIE = "tihiydom_agent_session";
const SESSION_TTL_SEC = 8 * 60 * 60; // 8 hours

export interface SessionPayload {
  userId: number;
  agentId: number;
  role: Role;
  name?: string;
  iat: number;
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// base64url helpers using only Web APIs (edge-compatible, no Buffer)
function toB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  u8.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = "===".slice((4 - (s.length % 4)) % 4);
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.APP_ENCRYPTION_KEY ?? "dev-key-tihiydom-not-for-production-ok";
  if (process.env.NODE_ENV === "production" && !process.env.APP_ENCRYPTION_KEY) {
    throw new Error("APP_ENCRYPTION_KEY must be set in production");
  }
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(data: Omit<SessionPayload, "iat" | "exp">): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...data, iat: now, exp: now + SESSION_TTL_SEC };
  // encode payload as UTF-8 bytes → base64url (handles non-ASCII names)
  const payloadBytes = enc.encode(JSON.stringify(payload));
  const encoded = toB64url(payloadBytes);
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(encoded));
  return `${encoded}.${toB64url(sig)}`;
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const encoded = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    const key = await getKey();
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(sigB64), enc.encode(encoded));
    if (!valid) return null;
    const payload = JSON.parse(dec.decode(fromB64url(encoded))) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
