import type { ReactNode } from "react";
import { getAgentSession } from "@/lib/auth";
import AgentSidebar from "./AgentSidebar";

export default async function AgentAppLayout({ children }: { children: ReactNode }) {
  const session = await getAgentSession();
  return (
    <div className="flex min-h-screen bg-[#080d18]">
      <AgentSidebar session={session} />
      <main className="ml-[240px] flex-1 min-h-screen min-w-0">{children}</main>
    </div>
  );
}
