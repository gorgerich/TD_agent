import type { ReactNode } from "react";
import { getAgentSession } from "@/lib/auth";
import AgentSidebar from "./AgentSidebar";

export default async function AgentAppLayout({ children }: { children: ReactNode }) {
  const session = await getAgentSession();
  return (
    <div className="min-h-[100dvh]">
      <AgentSidebar session={session} />
      <main className="relative min-h-[100dvh] pt-14 lg:pl-[248px] lg:pt-0">{children}</main>
    </div>
  );
}
