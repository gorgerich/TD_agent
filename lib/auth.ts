import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";

export type Role = "AGENT" | "SENIOR_AGENT" | "COORDINATOR" | "ADMIN" | "SUPPORT";

export interface AgentSession {
  userId: number;
  agentId: number;
  role: Role;
  name?: string;
}

const DEV_SESSION: AgentSession = {
  userId: 0,
  agentId: 0,
  role: "AGENT",
  name: "Агент (dev)",
};

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

    return { userId: payload.userId, agentId: payload.agentId, role: payload.role, name: payload.name };
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
  return { userId: payload.userId, agentId: payload.agentId, role: payload.role, name: payload.name };
}
