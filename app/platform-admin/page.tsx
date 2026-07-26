import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platformAuth";

export const dynamic = "force-dynamic";

export default async function PlatformAdminDashboard() {
  await requirePlatformAdmin();
  const [total, active, suspended, activeMemberships, roleGroups, recentAudit, attention] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { status: "ACTIVE" } }),
    prisma.organization.count({ where: { status: "SUSPENDED" } }),
    prisma.membership.count({ where: { status: "ACTIVE", organization: { status: "ACTIVE" } } }),
    prisma.membership.groupBy({ by: ["role"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    prisma.platformAuditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, targetType: true, targetId: true, createdAt: true, actor: { select: { name: true, email: true } } },
    }),
    prisma.organization.findMany({
      where: { OR: [{ status: "SUSPENDED" }, { memberships: { none: { role: "ADMIN", status: "ACTIVE" } } }] },
      take: 8,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, slug: true, status: true },
    }),
  ]);
  const roles = Object.fromEntries(roleGroups.map((group) => [group.role, group._count._all]));

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title="Обзор платформы" description="Организации, доступы и события управления без доступа к содержимому клиентских кейсов." />
      <section className="mt-7 grid gap-px overflow-hidden rounded-[14px] border border-[#d7dedb] bg-[#d7dedb] sm:grid-cols-2 xl:grid-cols-4" aria-label="Показатели платформы">
        <Metric label="Организации" value={total} detail={`${active} активных`} />
        <Metric label="Приостановлены" value={suspended} detail="Данные сохранены" tone={suspended ? "warning" : undefined} />
        <Metric label="Активные сотрудники" value={activeMemberships} detail="В активных организациях" />
        <Metric label="Роли" value={(roles.ADMIN ?? 0) + (roles.MANAGER ?? 0) + (roles.AGENT ?? 0)} detail={`${roles.ADMIN ?? 0} ADMIN · ${roles.MANAGER ?? 0} MANAGER · ${roles.AGENT ?? 0} AGENT`} />
      </section>

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-[14px] bg-white p-5 shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[17px] font-semibold">Последние действия</h2>
            <Link href="/platform-admin/audit" className="text-[12px] font-semibold text-[#176b5d]">Весь аудит</Link>
          </div>
          <div className="mt-4 divide-y divide-[#e5e9e7]">
            {recentAudit.length ? recentAudit.map((event) => (
              <div key={event.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <span>
                  <span className="block text-[13px] font-semibold">{auditLabel(event.action)}</span>
                  <span className="mt-0.5 block text-[12px] text-[#60716d]">{event.actor.name ?? event.actor.email ?? `User ${event.targetId ?? ""}`}</span>
                </span>
                <time className="text-[11px] text-[#71817d]">{formatDate(event.createdAt)}</time>
              </div>
            )) : <EmptyLine text="Глобальных административных событий пока нет." />}
          </div>
        </section>

        <section className="rounded-[14px] bg-[#e9eeec] p-5">
          <div className="flex items-center gap-2">
            <WarningCircle size={20} weight="fill" className="text-[#8a5d18]" />
            <h2 className="text-[15px] font-semibold">Требуют внимания</h2>
          </div>
          <div className="mt-4 space-y-2">
            {attention.length ? attention.map((organization) => (
              <Link key={organization.id} href={`/platform-admin/organizations/${organization.id}`} className="block rounded-[10px] bg-white px-4 py-3 transition-colors hover:bg-[#f9fbfa]">
                <span className="block text-[13px] font-semibold">{organization.name}</span>
                <span className="mt-1 block text-[11px] text-[#687974]">{organization.status === "SUSPENDED" ? "Организация приостановлена" : "Нет активного ADMIN"}</span>
              </Link>
            )) : <p className="text-[13px] leading-5 text-[#60716d]">Нет организаций с системными сигналами внимания.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="max-w-[760px]">
      <p className="text-[12px] font-semibold text-[#176b5d]">Администрирование платформы</p>
      <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em] text-[#132421] sm:text-[36px]">{title}</h1>
      <p className="mt-2 text-[14px] leading-6 text-[#536762]">{description}</p>
    </header>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: "warning" }) {
  return (
    <article className="min-h-[132px] bg-white p-5">
      <p className="text-[12px] font-medium text-[#667873]">{label}</p>
      <p className={`mt-3 text-[30px] font-semibold tabular-nums ${tone ? "text-[#8a5d18]" : "text-[#132421]"}`}>{value}</p>
      <p className="mt-2 text-[11px] text-[#71817d]">{detail}</p>
    </article>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="py-8 text-center text-[13px] text-[#71817d]">{text}</p>;
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function auditLabel(action: string) {
  return {
    PLATFORM_ROLE_BOOTSTRAPPED: "Назначен владелец платформы",
    ORGANIZATION_SUSPENDED: "Организация приостановлена",
    ORGANIZATION_REACTIVATED: "Организация возобновлена",
  }[action] ?? action;
}
