import Link from "next/link";
import { CalendarDots, Plus, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Запланирована",
  IN_PROGRESS: "Идёт",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};

const STATUS_DOT: Record<string, string> = {
  SCHEDULED: "bg-info",
  IN_PROGRESS: "bg-warning",
  COMPLETED: "bg-success",
  CANCELLED: "bg-ink-3",
};

type MeetingRow = { id: number; status: string; scheduledAt: Date | null; lead: { name: string; phone: string } };

async function getMeetings(agentId: number, status?: string): Promise<MeetingRow[]> {
  try {
    return await prisma.meeting.findMany({
      where: { agentId, ...(status ? { status: status as "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" } : {}) },
      orderBy: { scheduledAt: "desc" },
      include: { lead: { select: { name: true, phone: true } } },
    });
  } catch {
    return [];
  }
}

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

const FILTERS = [
  { value: "", label: "Все" },
  { value: "SCHEDULED", label: "Запланированы" },
  { value: "IN_PROGRESS", label: "Идут" },
  { value: "COMPLETED", label: "Завершены" },
  { value: "CANCELLED", label: "Отменены" },
];

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const session = await getAgentSession();
  const meetings = await getMeetings(session?.agentId ?? 0, status);

  return (
    <div className="td-page mx-auto max-w-[1160px] px-4 py-7 sm:px-7 sm:py-10">
      <header className="rise mb-7 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">CRM</span>
          <h1 className="mt-4 font-serif text-[34px] leading-tight text-ink sm:text-[42px]">Встречи</h1>
        </div>
        <Link
          href="/agent/meetings/new"
          className="inline-flex min-h-12 flex-shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent shadow-[0_14px_30px_-20px_rgba(32,79,67,0.8)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-accent-hover"
        >
          <Plus size={15} weight="bold" /> <span className="hidden sm:inline">Новая встреча</span><span className="sm:hidden">Встреча</span>
        </Link>
      </header>

      {/* Filter pills — horizontally scrollable on mobile */}
      <div className="rise rise-1 -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={f.value}
              href={f.value ? `/agent/meetings?status=${f.value}` : "/agent/meetings"}
              aria-current={active ? "page" : undefined}
              className={[
                "flex min-h-10 flex-shrink-0 items-center rounded-full border px-4 py-1.5 text-[12.5px] font-semibold transition-colors",
                active
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
              ].join(" ")}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="rise rise-2 td-shell overflow-hidden">
        <div className="td-core overflow-hidden">
        {meetings.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <CalendarDots size={36} className="mx-auto mb-3 text-accent" />
            <p className="text-[13.5px] text-ink-2">
              Встреч нет,{" "}
              <Link href="/agent/meetings/new" className="text-accent hover:text-accent-hover">назначить</Link>
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="divide-y divide-line sm:hidden">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link href={`/agent/meetings/${m.id}`} className="block px-4 py-4 transition-colors active:bg-surface-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[15px] font-semibold text-ink">{m.lead.name}</span>
                      <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[m.status] ?? "bg-ink-3"}`} />{STATUS_LABELS[m.status] ?? m.status}
                      </span>
                    </div>
                    <div className="tnum mt-1 flex items-center gap-3 text-[12.5px] text-ink-2">
                      <span>{m.lead.phone}</span>
                      <span className="ml-auto text-ink-3">{formatDate(m.scheduledAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <table className="hidden w-full sm:table">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Клиент</th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Телефон</th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Дата</th>
                  <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Статус</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id} className="group border-b border-line last:border-0 transition-colors hover:bg-accent-soft/55">
                    <td className="px-5 py-3.5">
                      <Link href={`/agent/meetings/${m.id}`} className="text-[14px] font-semibold text-ink transition-colors group-hover:text-accent">
                        {m.lead.name}
                      </Link>
                    </td>
                    <td className="tnum px-3 py-3.5 text-[13px] text-ink-2">{m.lead.phone}</td>
                    <td className="tnum px-3 py-3.5 text-[12.5px] text-ink-2">{formatDate(m.scheduledAt)}</td>
                    <td className="px-3 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[m.status] ?? "bg-ink-3"}`} />{STATUS_LABELS[m.status] ?? m.status}
                      </span>
                    </td>
                    <td className="pr-4">
                      <Link
                        href={`/agent/meetings/${m.id}`}
                        aria-label={`Открыть встречу: ${m.lead.name}`}
                        className="grid h-10 w-10 place-items-center rounded-[10px] transition-colors hover:bg-accent-soft"
                      >
                        <ArrowRight size={15} className="text-ink-3 transition-colors group-hover:text-accent" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
