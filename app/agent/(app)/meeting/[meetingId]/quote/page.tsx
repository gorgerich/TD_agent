import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
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

  const clientName = meeting?.lead?.name ?? "Клиент";

  return (
    <div>
      <nav className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 pt-7 sm:px-7 sm:pt-9">
        <Link
          href={`/agent/meetings/${meetingId}`}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} /> К встрече
        </Link>
        <span className="text-ink-3">·</span>
        <span className="text-[12.5px] font-medium text-ink-3">Конструктор сметы</span>
      </nav>

      <QuoteBuilder
        meetingId={meetingId}
        cobrowseCode={meeting?.cobrowseCode ?? null}
        clientName={clientName}
      />
    </div>
  );
}
