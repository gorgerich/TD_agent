import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AgentSidebar from "./AgentSidebar";
import AgentBottomNav from "./AgentBottomNav";
import OnboardingTour from "./OnboardingTour";
import CommandPalette from "@/components/CommandPalette";
import { ToastProvider } from "@/components/Toast";
import { hasCapability, hasTeamOperationalScope, isCoreOperationalRole } from "@/lib/operationalAuth";

async function getOnboardingCompleted(agentId: number): Promise<boolean> {
  if (!agentId) return false; // dev-заглушка / нет агента → показать онбординг
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { onboardingCompleted: true },
  });
  return agent?.onboardingCompleted ?? false;
}

// Просроченные задачи - для бейджа в навигации (in-app напоминание).
async function getOverdueCount(session: NonNullable<Awaited<ReturnType<typeof getAgentSession>>>, notify: boolean): Promise<number> {
  if (!session.agentId || !notify) return 0;
  return prisma.task.count({
    where: {
      organizationId: session.organizationId,
      status: "OPEN",
      dueAt: { lt: new Date() },
      ...(!hasTeamOperationalScope(session.role) ? { assigneeMembershipId: session.membershipId } : {}),
    },
  });
}

export default async function AgentAppLayout({ children }: { children: ReactNode }) {
  const session = await getAgentSession();

  // Гард авторизации в Node-рантайме (надёжный доступ к APP_ENCRYPTION_KEY).
  // В dev getAgentSession отдаёт заглушку, поэтому редиректа не будет.
  if (!session) redirect("/agent/login");
  if (session.role === "FINANCE" && session.mfaVerified !== true) {
    redirect("/setup/platform-admin-mfa");
  }

  const coreWorkspace = isCoreOperationalRole(session.role);
  if (!coreWorkspace) {
    const path = (await headers()).get("x-td-agent-path") ?? "";
    const landing = session.role === "DOCUMENT_REVIEWER" ? "/agent/document-review" : "/agent/finance";
    if (!path.startsWith(landing)) redirect(landing);
  }

  const [onboardingCompleted, agentMeta] = await Promise.all([
    coreWorkspace ? getOnboardingCompleted(session.agentId) : Promise.resolve(true),
    coreWorkspace
      ? prisma.agent.findUnique({ where: { id: session.agentId }, select: { notifyEnabled: true } })
      : Promise.resolve(null),
  ]);
  const overdue = hasCapability(session.role, "work:read")
    ? await getOverdueCount(session, agentMeta?.notifyEnabled ?? true)
    : 0;

  return (
    <ToastProvider>
      <div className="min-h-[100dvh]">
        <AgentSidebar session={session} overdue={overdue} />
        <main id="main-content" className="relative min-h-[100dvh] pb-[104px] pt-14 lg:pb-0 lg:pl-[260px] lg:pt-0">
          {children}
        </main>
        <AgentBottomNav overdue={overdue} role={session.role} />
        {coreWorkspace && <CommandPalette />}
        {coreWorkspace && <OnboardingTour onboardingCompleted={onboardingCompleted} />}
      </div>
    </ToastProvider>
  );
}
