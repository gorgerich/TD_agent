import { prisma } from "./prisma";
import { normalizeSelection, type AttrSelection } from "./attributes";
import { encryptString, decryptStringStrict, EncryptedDataUnavailableError } from "./crypto";
import type { PublicEstimateItem, PublicExternalExpense } from "./calculationUtils";

/*
  Общее состояние встречи (co-work) — хранится в БД (AgentSession), а не в памяти
  процесса: на Vercel serverless агент и клиент попадают на разные инстансы, и
  in-memory не синхронизируется. AgentSession.meetingId уникален.

  Форма состояния: { form, cemeteryCategory, attributes, estimateItems, _ts }
*/

const TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

export interface CoState {
  form?: unknown;
  cemeteryCategory?: string;
  attributes?: AttrSelection;
  estimateItems?: PublicEstimateItem[];
  externalExpenses?: PublicExternalExpense[];
  _ts?: number;
}

export async function readCoState(meetingId: number, db = prisma): Promise<{ state: CoState; updatedAt: number } | null> {
  const row = await db.agentSession.findUnique({ where: { meetingId } });
  if (!row) return null;
  const state = parseCoState(row.state);
  return { state, updatedAt: state._ts ?? 0 };
}

function parseCoState(stored: string): CoState {
  try {
    const state: unknown = JSON.parse(decryptStringStrict(stored));
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new EncryptedDataUnavailableError();
    return state as CoState;
  } catch {
    throw new EncryptedDataUnavailableError();
  }
}

/** Полная запись состояния (агент). */
export async function writeCoState(meetingId: number, state: CoState, db = prisma): Promise<boolean> {
  const payload = encryptString(JSON.stringify({ ...state, _ts: Date.now() }));
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.agentSession.upsert({
    where: { meetingId },
    update: { state: payload, expiresAt },
    create: { meetingId, state: payload, expiresAt },
  });
  return true;
}

/** Частичная правка только атрибутики (клиент). Мержит в существующее состояние. */
export async function mergeCoAttributes(meetingId: number, rawAttributes: unknown, db = prisma): Promise<boolean> {
  const attributes = normalizeSelection(rawAttributes);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const existing = await db.agentSession.findUnique({ where: { meetingId } });
  const base: CoState = existing ? parseCoState(existing.state) : {};
  const next: CoState = { ...base, attributes, _ts: Date.now() };
  const payload = encryptString(JSON.stringify(next));
  await db.agentSession.upsert({
    where: { meetingId },
    update: { state: payload, expiresAt },
    create: { meetingId, state: payload, expiresAt },
  });
  return true;
}
