import { getAgentSession } from "@/lib/auth";
import { redirect } from "next/navigation";

// Экран 2 — dashboard. Серверная проверка сессии (middleware — лишь грубый gate).
export default async function AgentDashboardPage() {
  const session = await getAgentSession();
  if (!session) redirect("/agent/login");

  // TODO: виджеты — встречи на сегодня, лиды в работе, начисленная комиссия, KPI.
  return (
    <main style={{ maxWidth: 960, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Дашборд агента</h1>
      <p>Роль: {session.role}</p>
    </main>
  );
}
