import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AgentSidebar from "./AgentSidebar";
import AgentBottomNav from "./AgentBottomNav";
import OnboardingTour from "./OnboardingTour";
import CommandPalette from "@/components/CommandPalette";
import { ToastProvider } from "@/components/Toast";

async function getOnboardingCompleted(agentId: number): Promise<boolean> {
  if (!agentId) return false; // dev-заглушка / нет агента → показать онбординг
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { onboardingCompleted: true },
    });
    return agent?.onboardingCompleted ?? false;
  } catch {
    return true; // БД недоступна → не навязываем тур
  }
}

export default async function AgentAppLayout({ children }: { children: ReactNode }) {
  const session = await getAgentSession();

  // Гард авторизации в Node-рантайме (надёжный доступ к APP_ENCRYPTION_KEY).
  // В dev getAgentSession отдаёт заглушку, поэтому редиректа не будет.
  if (!session) redirect("/agent/login");

  const onboardingCompleted = await getOnboardingCompleted(session.agentId);

  return (
    <ToastProvider>
      <div className="min-h-[100dvh]">
        <AgentSidebar session={session} />
        <main id="main-content" className="relative min-h-[100dvh] pb-[72px] pt-14 lg:pb-0 lg:pl-[260px] lg:pt-0">
          {children}
        </main>
        <AgentBottomNav />
        <CommandPalette />
        <OnboardingTour onboardingCompleted={onboardingCompleted} />
      </div>
    </ToastProvider>
  );
}
