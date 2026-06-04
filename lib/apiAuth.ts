import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionFromRequest, type AgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Единые помощники для API-роутов агента: авторизация, проверка владения
 * ресурсом и нормализация ошибок. Убирают дублирование try/catch + 401/404/503
 * по всем хендлерам и закрывают IDOR (ресурс должен принадлежать агенту сессии).
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Достаёт сессию агента или бросает 401. */
export async function requireAgent(req: Request): Promise<AgentSession> {
  const session = await getSessionFromRequest(req);
  if (!session) throw new ApiError(401, "Unauthorized");
  return session;
}

/** Парсит positive-int id из строки роута или бросает 400. */
export function parseId(raw: string, label = "id"): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `Некорректный ${label}`);
  return id;
}

/** Встреча должна принадлежать агенту — иначе 404 (не раскрываем существование). */
export async function assertMeetingOwned(meetingId: number, agentId: number): Promise<void> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, agentId },
    select: { id: true },
  });
  if (!meeting) throw new ApiError(404, "Встреча не найдена");
}

/** Лид должен принадлежать агенту — иначе 404. */
export async function assertLeadOwned(leadId: number, agentId: number): Promise<void> {
  const lead = await prisma.clientLead.findFirst({
    where: { id: leadId, agentId },
    select: { id: true },
  });
  if (!lead) throw new ApiError(404, "Клиент не найден");
}

/** Превращает исключение в корректный JSON-ответ (ApiError → его статус; БД → 503; иначе 500). */
export function handleApiError(err: unknown, context?: string): NextResponse {
  if (err instanceof ApiError) {
    return jsonError(err.status, err.message);
  }

  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Error && /Can't reach database|ECONNREFUSED|P1001|P1002/.test(err.message))
  ) {
    return jsonError(503, "База данных недоступна. Попробуйте ещё раз через минуту.");
  }

  console.error("[api]%s", context ? ` ${context}` : "", err);
  const detail = process.env.NODE_ENV === "production" ? undefined : (err as Error)?.message;
  return NextResponse.json({ error: "Внутренняя ошибка", detail }, { status: 500 });
}
