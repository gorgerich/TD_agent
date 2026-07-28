export const SESSION_COOKIE = "tihiydom_agent_session";
const SESSION_TTL_SEC = 8 * 60 * 60; // 8 hours

export interface SessionPayload {
  userId: number;
  version: 1 | 2;
  sessionVersion?: number;
  mfaVerified?: boolean;
  activeMembershipId?: string;
  // Legacy v1 selectors remain parseable until old cookies expire. Neither
  // field is an authorization claim.
  agentId?: number;
  role?: string;
  name?: string;
  iat: number;
  exp: number;
}

export type SessionClaims = {
  userId: number;
  sessionVersion?: number;
  mfaVerified?: boolean;
  activeMembershipId?: string;
  version?: 1 | 2;
  agentId?: number;
  role?: string;
  name?: string;
};

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
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
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

export async function signSession(data: SessionClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...data,
    version: data.version ?? 2,
    iat: now,
    exp: now + SESSION_TTL_SEC,
  };
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
    const payload = JSON.parse(dec.decode(fromB64url(encoded))) as unknown;
    if (!isSessionPayload(payload)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { ...payload, version: payload.version ?? 1 };
  } catch {
    return null;
  }
}

export function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  const version = payload.version ?? 1;
  return (
    (version === 1 || version === 2)
    && Number.isInteger(payload.userId)
    && Number(payload.userId) > 0
    && Number.isInteger(payload.iat)
    && Number.isInteger(payload.exp)
    && (payload.sessionVersion === undefined || (Number.isInteger(payload.sessionVersion) && Number(payload.sessionVersion) >= 0))
    && (payload.mfaVerified === undefined || typeof payload.mfaVerified === "boolean")
    && (payload.activeMembershipId === undefined || typeof payload.activeMembershipId === "string")
    && (payload.agentId === undefined || (Number.isInteger(payload.agentId) && Number(payload.agentId) > 0))
  );
}
