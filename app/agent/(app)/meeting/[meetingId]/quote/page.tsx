import { redirect } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import QuoteBuilder from "./QuoteBuilder";
import s from "./QuoteBuilder.module.css";

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId: meetingIdStr } = await params;
  const meetingId = Number(meetingIdStr);

  if (isNaN(meetingId)) redirect("/agent/dashboard");

  const session = await getAgentSession();
  if (!session && process.env.NODE_ENV !== "development") {
    redirect("/agent/login");
  }

  type MeetingRow = {
    id: number;
    cobrowseCode: string | null;
    lead: { name: string } | null;
  };
  let meeting: MeetingRow | null = null;

  try {
    meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, cobrowseCode: true, lead: { select: { name: true } } },
    });
  } catch {
    // DB not configured in local dev — proceed with nulls
  }

  const clientName = meeting?.lead?.name ?? `Клиент`;

  return (
    <div className={s.page}>
      <nav className={s.pageNav}>
        <a href="/agent/dashboard" className={s.backLink}>
          ← Дашборд
        </a>
        <h1 className={s.pageTitle}>Конструктор сметы</h1>
      </nav>

      <QuoteBuilder
        meetingId={meetingId}
        cobrowseCode={meeting?.cobrowseCode ?? null}
        clientName={clientName}
      />
    </div>
  );
}
