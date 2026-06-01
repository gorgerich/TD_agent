import Link from "next/link";
import { Users, Plus, ArrowRight, CalendarBlank } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort, phone } from "@/lib/format";

type Lead = { id: number; name: string; phone: string; context: string | null; source: string; createdAt: Date; meetings: { status: string }[] };

async function getLeads(agentId: number): Promise<Lead[]> {
  try {
    return await prisma.clientLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      include: { meetings: { select: { status: true } } },
    });
  } catch {
    return [];
  }
}

function getStatus(meetings: { status: string }[]) {
  if (meetings.length === 0) return { label: "Новый", dot: "bg-info" };
  if (meetings.some((m) => m.status === "COMPLETED")) return { label: "Завершён", dot: "bg-success" };
  return { label: "В работе", dot: "bg-warning" };
}

const SOURCE_LABELS: Record<string, string> = {
  agent: "Агент",
  telegram: "Telegram",
  form: "Форма",
  referral: "Рекомендация",
};

export default async function LeadsPage() {
  const session = await getAgentSession();
  const leads = await getLeads(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[1160px] px-4 py-7 sm:px-7 sm:py-10">
      <header className="rise mb-7 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">База клиентов</span>
          <h1 className="mt-4 font-serif text-[34px] leading-tight text-ink sm:text-[42px]">Клиенты</h1>
        </div>
        <Link
          href="/agent/leads/new"
          className="inline-flex min-h-12 flex-shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent shadow-[0_14px_30px_-20px_rgba(32,79,67,0.8)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-accent-hover"
        >
          <Plus size={15} weight="bold" /> <span className="hidden sm:inline">Новый клиент</span><span className="sm:hidden">Клиент</span>
        </Link>
      </header>

      <div className="rise rise-1 td-shell overflow-hidden">
        <div className="td-core overflow-hidden">
        {leads.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent-soft text-accent">
              <Users size={28} weight="duotone" />
            </span>
            <h2 className="font-serif text-[20px] text-ink">Здесь будут ваши клиенты</h2>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[13.5px] leading-relaxed text-ink-2">
              Добавьте первого клиента — имя и телефон. Дальше назначите встречу и соберёте смету.
            </p>
            <Link
              href="/agent/leads/new"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-transform duration-200 hover:-translate-y-0.5 hover:bg-accent-hover"
            >
              <Plus size={16} weight="bold" /> Добавить клиента
            </Link>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {leads.map((lead) => {
                const st = getStatus(lead.meetings);
                return (
                  <li key={lead.id}>
                    <Link href={`/agent/leads/${lead.id}`} className="block px-4 py-4 transition-colors active:bg-surface-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-[15px] font-semibold text-ink">{lead.name}</span>
                        <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}
                        </span>
                      </div>
                      <div className="tnum mt-1 text-[13px] text-ink-2">{phone(lead.phone)}</div>
                      {lead.context && <p className="mt-1.5 line-clamp-2 text-[12.5px] text-ink-3">{lead.context}</p>}
                      <div className="mt-2 flex items-center gap-3 text-[11.5px] text-ink-3">
                        <span>{SOURCE_LABELS[lead.source] ?? lead.source}</span>
                        <span className="inline-flex items-center gap-1"><CalendarBlank size={12} />{lead.meetings.length}</span>
                        <span className="tnum ml-auto">{dateShort(lead.createdAt)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Desktop table */}
            <table className="hidden w-full md:table">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Клиент</th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Телефон</th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Источник</th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Встречи</th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Статус</th>
                  <th className="px-5 py-3 text-right text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Добавлен</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const st = getStatus(lead.meetings);
                  return (
                    <tr key={lead.id} className="group border-b border-line last:border-0 transition-colors hover:bg-accent-soft/55">
                      <td className="px-5 py-3.5">
                        <Link href={`/agent/leads/${lead.id}`} className="text-[14px] font-semibold text-ink transition-colors group-hover:text-accent">
                          {lead.name}
                        </Link>
                        {lead.context && <p className="mt-0.5 max-w-[230px] truncate text-[11.5px] text-ink-3">{lead.context}</p>}
                      </td>
                      <td className="tnum px-3 py-3.5 text-[13px] text-ink-2">{phone(lead.phone)}</td>
                      <td className="px-3 py-3.5 text-[12.5px] text-ink-2">{SOURCE_LABELS[lead.source] ?? lead.source}</td>
                      <td className="px-3 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                          <CalendarBlank size={13} className="text-ink-3" />{lead.meetings.length}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}
                        </span>
                      </td>
                      <td className="tnum px-5 py-3.5 text-right text-[12.5px] text-ink-3">{dateShort(lead.createdAt)}</td>
                      <td className="pr-4">
                        <Link
                          href={`/agent/leads/${lead.id}`}
                          aria-label={`Открыть клиента: ${lead.name}`}
                          className="grid h-10 w-10 place-items-center rounded-[10px] transition-colors hover:bg-accent-soft"
                        >
                          <ArrowRight size={15} className="text-ink-3 transition-colors group-hover:text-accent" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
