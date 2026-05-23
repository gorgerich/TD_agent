// Auth-контур B2B. Рекомендация — Auth.js (NextAuth v5), роли проверяются против БД.
// Реализация отложена: auth-библиотеки в прод-репозитории нет, выбор провайдера/таблиц
// требует решения. Здесь — только контракт типов и заглушка, на которую опирается middleware.

export type Role = "AGENT" | "SENIOR_AGENT" | "COORDINATOR" | "ADMIN" | "SUPPORT";

export interface AgentSession {
  userId: number;
  agentId: number;
  role: Role;
}

// NOT IMPLEMENTED: подключить Auth.js, читать роль из БД (User/Agent), не из JWT-only.
// Возвращает null → middleware редиректит на /agent/login.
export async function getAgentSession(): Promise<AgentSession | null> {
  return null;
}
