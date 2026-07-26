import { cookies } from "next/headers";
import type { PlatformRole } from "@prisma/client";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";
import {
  resolveOperationalContextForUser,
  type OperationalContext,
  type OperationalRole,
} from "./operationalAuth";
import { prisma } from "./prisma";

export type Role = "AGENT" | "MANAGER" | "SENIOR_AGENT" | "COORDINATOR" | "ADMIN" | "SUPPORT";

export type AuthenticatedUserSession = {
  userId: number;
  platformRole: PlatformRole;
  activeMembershipId?: string;
  name?: string;
  email?: string;
  hasOperationalAccess: boolean;
};

export type AgentSession = OperationalContext;

const DEV_SESSION: AgentSession = {
  userId: 0,
  agentId: 0,
  membershipId: "development",
  organizationId: "development",
  role: "AGENT",
  timezone: "Europe/Moscow",
  name: "Агент (dev)",
  platformRole: "USER",
};

async function hydrateUserSession(payload: SessionPayload): Promise<AuthenticatedUserSession | null> {
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
      memberships: {
        where: {
          status: "ACTIVE",
          organization: { status: "ACTIVE" },
          agent: { status: "ACTIVE" },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, agentId: true },
      },
    },
  });
  if (!user) return null;

  const selected = payload.activeMembershipId
    ? user.memberships.find((membership) => membership.id === payload.activeMembershipId)
    : payload.agentId
      ? user.memberships.find((membership) => membership.agentId === payload.agentId)
      : user.memberships[0];

  return {
    userId: user.id,
    platformRole: user.platformRole,
    activeMembershipId: selected?.id,
    name: user.name ?? payload.name,
    email: user.email ?? undefined,
    hasOperationalAccess: user.memberships.length > 0,
  };
}

async function payloadFromCookieHeader(cookieHeader: string): Promise<SessionPayload | null> {
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ? verifySession(match[1]) : null;
}

export async function getCurrentUserSession(): Promise<AuthenticatedUserSession | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const payload = await verifySession(token);
    return payload ? hydrateUserSession(payload) : null;
  } catch {
    return null;
  }
}

export async function getCurrentUserSessionFromRequest(req: Request): Promise<AuthenticatedUserSession | null> {
  const payload = await payloadFromCookieHeader(req.headers.get("cookie") ?? "");
  return payload ? hydrateUserSession(payload) : null;
}

export async function requireAuthenticatedUser(req?: Request): Promise<AuthenticatedUserSession> {
  const session = req ? await getCurrentUserSessionFromRequest(req) : await getCurrentUserSession();
  if (!session) throw new AuthenticationError(401, "Unauthorized");
  return session;
}

async function operationalFromUser(user: AuthenticatedUserSession): Promise<AgentSession | null> {
  if (!user.activeMembershipId) return null;
  return resolveOperationalContextForUser(user.userId, { activeMembershipId: user.activeMembershipId });
}

export async function getOperationalContext(): Promise<AgentSession | null> {
  const user = await getCurrentUserSession();
  return user ? operationalFromUser(user) : null;
}

export async function getOperationalContextFromRequest(req: Request): Promise<AgentSession | null> {
  const user = await getCurrentUserSessionFromRequest(req);
  return user ? operationalFromUser(user) : null;
}

export async function requireOperationalContext(req?: Request): Promise<AgentSession> {
  const session = req ? await getOperationalContextFromRequest(req) : await getOperationalContext();
  if (!session) throw new AuthenticationError(401, "Operational access unavailable");
  return session;
}

// Backward-compatible wrappers while existing agent routes migrate.
export async function getAgentSession(): Promise<AgentSession | null> {
  try {
    const session = await getOperationalContext();
    if (!session && process.env.NODE_ENV === "development") return DEV_SESSION;
    return session;
  } catch {
    if (process.env.NODE_ENV === "development") return DEV_SESSION;
    return null;
  }
}

export async function getSessionFromRequest(req: Request): Promise<AgentSession | null> {
  const session = await getOperationalContextFromRequest(req);
  if (!session && process.env.NODE_ENV === "development") return DEV_SESSION;
  return session;
}

export class AuthenticationError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export type { OperationalRole };
