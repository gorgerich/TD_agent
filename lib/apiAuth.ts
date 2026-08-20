import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  AuthenticationError,
  getCurrentUserSessionFromRequest,
  getSessionFromRequest,
  type AgentSession,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OperationalAuthError, isCoreOperationalRole, type OperationalRole } from "@/lib/operationalAuth";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import { CommercialQuoteError } from "@/lib/commercialQuote";

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

/** Достаёт сессию агента или бросает 401. Fail-closed: dev-заглушка
 *  (agentId 0) допустима ТОЛЬКО в development; в проде такая сессия = 401. */
export async function requireAgent(
  req: Request,
  options: { allowAdminMutation?: boolean; allowedRoles?: readonly OperationalRole[] } = {},
): Promise<AgentSession> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    const user = await getCurrentUserSessionFromRequest(req);
    throw new ApiError(user ? 403 : 401, user ? "Operational access unavailable" : "Unauthorized");
  }
  if (session.agentId <= 0 && process.env.NODE_ENV !== "development") {
    throw new ApiError(401, "Unauthorized");
  }
  if (session.role === "FINANCE" && session.mfaVerified !== true) {
    throw new ApiError(403, "Для финансовых операций требуется двухфакторная аутентификация");
  }
  const roleAllowed = options.allowedRoles
    ? options.allowedRoles.includes(session.role)
    : isCoreOperationalRole(session.role);
  if (!roleAllowed) throw new ApiError(403, "Недостаточно прав для этого маршрута");
  if (
    session.role === "ADMIN"
    && !options.allowAdminMutation
    && !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())
  ) {
    throw new ApiError(403, "Администратор организации не может изменять операционные данные через этот маршрут");
  }
  return session;
}

/** True для dev-заглушки без агента (проверки владения пропускаются,
 *  но только в development — requireAgent уже отсёк её в проде). */
function isDevStub(session: AgentSession): boolean {
  return session.agentId <= 0;
}

/** Безусловная проверка доступа к лиду. Вместо fail-open паттерна
 *  `if (session.agentId) await assertLeadOwned(...)` на месте вызова. */
export async function assertLeadAccess(leadId: number, session: AgentSession): Promise<void> {
  if (isDevStub(session)) return; // только development
  await assertLeadOwned(leadId, session);
}

/** Безусловная проверка доступа к встрече (см. assertLeadAccess). */
export async function assertMeetingAccess(meetingId: number, session: AgentSession): Promise<void> {
  if (isDevStub(session)) return; // только development
  await assertMeetingOwned(meetingId, session);
}

/** Парсит positive-int id из строки роута или бросает 400. */
export function parseId(raw: string, label = "id"): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `Некорректный ${label}`);
  return id;
}

/** Встреча должна принадлежать агенту — иначе 404 (не раскрываем существование). */
export async function assertMeetingOwned(meetingId: number, session: AgentSession | number): Promise<void> {
  const legacyAgentId = typeof session === "number" ? session : session.agentId;
  const meeting = await prisma.meeting.findFirst({
    where: typeof session === "number"
      ? { id: meetingId, agentId: legacyAgentId }
      : {
          id: meetingId,
          organizationId: session.organizationId,
          ...(session.role === "MANAGER" || session.role === "ADMIN" ? {} : { ownerMembershipId: session.membershipId }),
        },
    select: { id: true },
  });
  if (!meeting) throw new ApiError(404, "Встреча не найдена");
}

/** Лид должен принадлежать агенту — иначе 404. */
export async function assertLeadOwned(leadId: number, session: AgentSession | number): Promise<void> {
  const legacyAgentId = typeof session === "number" ? session : session.agentId;
  const lead = await prisma.clientLead.findFirst({
    where: typeof session === "number"
      ? { id: leadId, agentId: legacyAgentId }
      : {
          id: leadId,
          case: {
            tenantId: session.organizationId,
            ...(session.role === "MANAGER" || session.role === "ADMIN" ? {} : { ownerId: session.agentId }),
          },
        },
    select: { id: true },
  });
  if (!lead) throw new ApiError(404, "Клиент не найден");
}

/** Превращает исключение в корректный JSON-ответ (ApiError → его статус; БД → 503; иначе 500). */
export function handleApiError(err: unknown, context?: string): NextResponse {
  if (err instanceof ApiError) {
    return jsonError(err.status, err.message);
  }

  if (err instanceof OperationalAuthError) {
    return jsonError(err.status, err.message);
  }

  if (err instanceof AuthenticationError) {
    return jsonError(err.status, err.message);
  }

  if (err instanceof OperationalCommandError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }

  if (err instanceof CommercialQuoteError) {
    if (err.code === "CLIENT_LINK_SECRET_MISSING") {
      return NextResponse.json(
        { error: "Сервис защищённых ссылок временно недоступен", code: err.code },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
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
