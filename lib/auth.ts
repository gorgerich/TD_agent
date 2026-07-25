import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";
import { resolveOperationalContext, type OperationalRole } from "./operationalAuth";

export type Role = "AGENT" | "MANAGER" | "SENIOR_AGENT" | "COORDINATOR" | "ADMIN" | "SUPPORT";

export interface AgentSession {
  userId: number;
  agentId: number;
  membershipId: string;
  organizationId: string;
  role: OperationalRole;
  timezone: string;
  name?: string;
}

const DEV_SESSION: AgentSession = {
  userId: 0,
  agentId: 0,
  membershipId: "development",
  organizationId: "development",
  role: "AGENT",
  timezone: "Europe/Moscow",
  name: "Агент (dev)",
};

async function hydrateSession(payload: SessionPayload): Promise<AgentSession | null> {
  const context = await resolveOperationalContext(payload.userId, payload.agentId);
  if (!context) return null;
  return { ...context, name: context.name ?? payload.name };
}

export async function getAgentSession(): Promise<AgentSession | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;

    if (!token) {
      // Dev bypass: no cookie → return mock session so all pages render
      if (process.env.NODE_ENV === "development") return DEV_SESSION;
      return null;
    }

    const payload: SessionPayload | null = await verifySession(token);
    if (!payload) return null;

    return hydrateSession(payload);
  } catch {
    if (process.env.NODE_ENV === "development") return DEV_SESSION;
    return null;
  }
}

// Utility for API routes — reads cookie from request headers
export async function getSessionFromRequest(req: Request): Promise<AgentSession | null> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  const token = match?.[1];
  if (!token) {
    if (process.env.NODE_ENV === "development") return DEV_SESSION;
    return null;
  }
  const payload = await verifySession(token);
  if (!payload) return null;
  return hydrateSession(payload);
}
