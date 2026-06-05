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
    cobrowseCode: string | null;
    lead: { id: number; name: string } | null;
  };
  let meeting: MeetingRow | null = null;

  try {
    meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, cobrowseCode: true, lead: { select: { id: true, name: true } } },
    });
  } catch {
    // DB not configured in local dev — proceed with nulls
  }

  const clientName = meeting?.lead?.name ?? "Клиент";
  const caseId = meeting?.lead?.id;

  return (
    <div>
      <nav aria-label="Навигация" className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-1.5 px-4 pt-7 text-[12.5px] sm:px-7 sm:pt-9">
        <Link href={caseId ? `/agent/cases/${caseId}` : "/agent/cases"} className="inline-flex items-center gap-1 text-ink-3 transition-colors hover:text-ink">
          <ArrowLeft size={13} /> Назад
        </Link>
        <span className="mx-1 h-3 w-px bg-line-strong" aria-hidden />
        <Link href="/agent/cases" className="text-ink-3 transition-colors hover:text-ink">Дела</Link>
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
        cobrowseCode={meeting?.cobrowseCode ?? null}
        clientName={clientName}
      />
    </div>
  );
}
