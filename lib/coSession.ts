import { prisma } from "./prisma";
import { normalizeSelection, type AttrSelection } from "./attributes";
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

export async function readCoState(meetingId: number): Promise<{ state: CoState; updatedAt: number } | null> {
  try {
    const row = await prisma.agentSession.findUnique({ where: { meetingId } });
    if (!row) return null;
    const state = JSON.parse(row.state) as CoState;
    return { state, updatedAt: state._ts ?? 0 };
  } catch {
    return null;
  }
}

/** Полная запись состояния (агент). */
export async function writeCoState(meetingId: number, state: CoState): Promise<boolean> {
  const payload = JSON.stringify({ ...state, _ts: Date.now() });
  const expiresAt = new Date(Date.now() + TTL_MS);
  try {
    await prisma.agentSession.upsert({
      where: { meetingId },
      update: { state: payload, expiresAt },
      create: { meetingId, state: payload, expiresAt },
    });
    return true;
  } catch {
    return false;
  }
}

/** Частичная правка только атрибутики (клиент). Мержит в существующее состояние. */
export async function mergeCoAttributes(meetingId: number, rawAttributes: unknown): Promise<boolean> {
  const attributes = normalizeSelection(rawAttributes);
  const expiresAt = new Date(Date.now() + TTL_MS);
  try {
    const existing = await prisma.agentSession.findUnique({ where: { meetingId } });
    const base: CoState = existing ? (JSON.parse(existing.state) as CoState) : {};
    const next: CoState = { ...base, attributes, _ts: Date.now() };
    const payload = JSON.stringify(next);
    await prisma.agentSession.upsert({
      where: { meetingId },
      update: { state: payload, expiresAt },
      create: { meetingId, state: payload, expiresAt },
    });
    return true;
  } catch {
    return false;
  }
}
