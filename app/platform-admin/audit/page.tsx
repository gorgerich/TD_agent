import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { PageHeader, auditLabel, formatDate } from "../page";

export const dynamic = "force-dynamic";

export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const action = typeof params.action === "string" ? params.action.trim().slice(0, 80) : "";
  const events = await prisma.platformAuditEvent.findMany({
    where: action ? { action } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: { id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true, actor: { select: { name: true, email: true } } },
  });
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Аудит платформы" description="Глобальные административные события. Tenant-операции остаются в журнале своей организации." />
      <form className="mt-6 flex gap-3 rounded-[12px] bg-white p-3 shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        <select name="action" defaultValue={action} aria-label="Фильтр действия" className="min-h-11 min-w-0 flex-1 rounded-[9px] bg-[#f3f5f4] px-3 text-[13px]">
          <option value="">Все действия</option>
          <option value="PLATFORM_ROLE_BOOTSTRAPPED">Назначение владельца</option>
          <option value="ORGANIZATION_SUSPENDED">Приостановка организации</option>
          <option value="ORGANIZATION_REACTIVATED">Возобновление организации</option>
        </select>
        <button className="min-h-11 rounded-[9px] bg-[#0d2f2a] px-5 text-[13px] font-semibold text-white">Применить</button>
      </form>
      <div className="mt-5 overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        {events.length ? events.map((event) => (
          <div key={event.id} className="grid gap-2 border-b border-[#e5e9e7] px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(220px,1fr)_180px_160px_minmax(180px,1fr)] lg:items-center">
            <span><span className="block text-[13px] font-semibold">{auditLabel(event.action)}</span><span className="mt-0.5 block text-[11px] text-[#71817d]">{event.targetType} {event.targetId ?? ""}</span></span>
            <span className="text-[12px] text-[#60716d]">{event.actor.name ?? event.actor.email ?? "Системный пользователь"}</span>
            <time className="text-[12px] text-[#60716d]">{formatDate(event.createdAt)}</time>
            <code className="overflow-hidden text-ellipsis text-[11px] text-[#71817d]">{JSON.stringify(event.metadata)}</code>
          </div>
        )) : <p className="px-5 py-16 text-center text-[13px] text-[#71817d]">Событий по фильтру нет.</p>}
      </div>
    </div>
  );
}
