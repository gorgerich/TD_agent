import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import QuoteBuilder from "./QuoteBuilder";

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId: meetingIdStr } = await params;
  const meetingId = Number(meetingIdStr);

  if (isNaN(meetingId)) redirect("/agent/cases");

  const session = await getAgentSession();
  if (!session && process.env.NODE_ENV !== "development") {
    redirect("/agent/login");
  }

  type MeetingRow = {
    id: number;
    lead: { id: number; name: string } | null;
  };
  const meeting: MeetingRow | null = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      organizationId: session?.organizationId ?? "development",
      ...(session?.role === "AGENT" ? { ownerMembershipId: session.membershipId } : {}),
    },
    select: { id: true, lead: { select: { id: true, name: true } } },
  });
  if (!meeting) redirect("/agent/meetings");

  const clientName = meeting?.lead?.name ?? "Клиент";
  const caseId = meeting?.lead?.id;

  return (
    <div>
      <nav aria-label="Навигация" className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-1.5 px-4 pt-5 text-[12px] sm:px-7 sm:pt-7">
        <Link href={caseId ? `/agent/cases/${caseId}` : "/agent/cases"} className="inline-flex items-center gap-1 text-ink-3 transition-colors hover:text-ink">
          <ArrowLeft size={13} /> Назад
        </Link>
        <span className="mx-1 h-3 w-px bg-line-strong" aria-hidden />
        <Link href="/agent/cases" className="text-ink-3 transition-colors hover:text-ink">Кейсы</Link>
        <CaretRight size={11} className="text-ink-3" aria-hidden />
        {caseId ? (
          <Link href={`/agent/cases/${caseId}`} className="text-ink-2 transition-colors hover:text-ink">{clientName}</Link>
        ) : (
          <span className="text-ink-2">{clientName}</span>
        )}
        <CaretRight size={11} className="text-ink-3" aria-hidden />
        <span className="font-semibold text-ink">Смета</span>
      </nav>

      <QuoteBuilder
        meetingId={meetingId}
        clientName={clientName}
        caseId={caseId}
      />
    </div>
  );
}
