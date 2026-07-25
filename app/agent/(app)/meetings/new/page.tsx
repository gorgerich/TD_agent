import Link from "next/link";
import { ArrowLeft, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import NewMeetingForm from "./NewMeetingForm";
import { getAgentSession, type AgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getMeetingOptions(session: AgentSession) {
  const [cases, memberships] = await Promise.all([
    prisma.case.findMany({
      where: {
        tenantId: session.organizationId,
        closedAt: null,
        ...(session.role === "AGENT" ? { ownerId: session.agentId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: { lead: { select: { id: true, name: true, phone: true } } },
      take: 120,
    }),
    prisma.membership.findMany({
      where: {
        organizationId: session.organizationId,
        status: "ACTIVE",
        agentId: { not: null },
        ...(session.role === "AGENT" ? { id: session.membershipId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  return {
    clients: cases.map((item) => item.lead),
    owners: memberships.map((item) => ({ membershipId: item.id, name: item.user.name ?? "Без имени" })),
  };
}

export default async function NewMeetingPage() {
  const session = await getAgentSession();
  if (!session) return null;
  const options = await getMeetingOptions(session);

  return (
    <div className="td-page mx-auto max-w-[900px] px-4 py-6 sm:px-7 sm:py-9">
      <header className="rise td-page-header mb-6">
        <Link href="/agent/meetings" className="mb-4 inline-flex min-h-10 items-center gap-1.5 text-[12px] font-semibold text-ink-2 hover:text-ink">
          <ArrowLeft size={14} weight="bold" /> Календарь
        </Link>
        <p className="text-[13px] font-semibold text-accent">Встреча с семьёй</p>
        <h1 className="td-display mt-1 text-[30px] leading-tight text-ink sm:text-[38px]">Новая встреча</h1>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">Кейс и ответственный обязательны. Время можно оставить открытым, пока семья его не подтвердила.</p>
      </header>

      {session.role === "ADMIN" ? (
        <div role="alert" className="flex max-w-[720px] items-start gap-3 rounded-[var(--radius-card)] bg-warning-soft px-5 py-4 text-[13px] text-ink-2">
          <WarningCircle size={18} weight="fill" className="mt-0.5 flex-none text-warning" />
          <span>Роль администратора предназначена для аудита. Создание встреч недоступно.</span>
        </div>
      ) : options.clients.length === 0 ? (
        <div className="max-w-[720px] rounded-[var(--radius-card)] bg-surface px-5 py-6 shadow-[var(--shadow-xs),var(--hl-top)]">
          <h2 className="text-[15px] font-semibold text-ink">Сначала нужен открытый кейс</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Встреча создаётся только внутри канонического кейса, поэтому случайный номер клиента ввести нельзя.</p>
          <Link href="/agent/cases" className="mt-4 inline-flex min-h-10 items-center text-[12px] font-semibold text-accent hover:text-accent-hover">Открыть кейсы</Link>
        </div>
      ) : (
        <NewMeetingForm
          clients={options.clients}
          owners={options.owners}
          defaultOwnerMembershipId={session.membershipId}
          timezone={session.timezone}
        />
      )}
    </div>
  );
}
