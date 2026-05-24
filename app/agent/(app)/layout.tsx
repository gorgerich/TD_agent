import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import AgentSidebar from "./AgentSidebar";

export default async function AgentAppLayout({ children }: { children: ReactNode }) {
  const session = await getAgentSession();

  // Гард авторизации в Node-рантайме (надёжный доступ к APP_ENCRYPTION_KEY).
  // В dev getAgentSession отдаёт заглушку, поэтому редиректа не будет.
  if (!session) redirect("/agent/login");

  return (
    <div className="min-h-[100dvh]">
      <AgentSidebar session={session} />
      <main className="relative min-h-[100dvh] pt-14 lg:pl-[248px] lg:pt-0">{children}</main>
    </div>
  );
}
