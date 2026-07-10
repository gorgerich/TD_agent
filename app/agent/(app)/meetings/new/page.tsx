import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import NewMeetingForm from "./NewMeetingForm";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getClients(agentId: number) {
  if (!agentId) return [];
  try {
    return await prisma.clientLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, phone: true },
      take: 80,
    });
  } catch {
    return [];
  }
}

export default async function NewMeetingPage() {
  const session = await getAgentSession();
  const clients = await getClients(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[900px] px-4 py-7 sm:px-7 sm:py-10">
      <header className="rise td-page-header mb-6">
        <Link href="/agent/meetings" className="mb-4 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-accent-soft hover:text-ink">
          <ArrowLeft size={14} weight="bold" /> Все встречи
        </Link>
        <span className="td-eyebrow">Встреча с семьёй</span>
        <h1 className="mt-2 td-display text-[34px] leading-tight text-ink sm:text-[42px]">Новая встреча</h1>
        <p className="mt-2 max-w-[58ch] text-[14px] leading-relaxed text-ink-2">Выберите клиента и зафиксируйте время. Кейс, смета и материалы будут доступны из карточки встречи.</p>
      </header>
      <NewMeetingForm clients={clients} />
    </div>
  );
}
