import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { PageHeader, formatDate } from "../../page";
import { Status } from "../page";
import { OrganizationStatusControl } from "./OrganizationStatusControl";

export const dynamic = "force-dynamic";

export default async function OrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  await requirePlatformAdmin();
  const { organizationId } = await params;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true, name: true, slug: true, timezone: true, status: true, createdAt: true,
      memberships: {
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { id: true, role: true, status: true, createdAt: true, user: { select: { name: true, email: true } }, agent: { select: { status: true } } },
      },
      auditEvents: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, action: true, entityType: true, createdAt: true },
      },
    },
  });
  if (!organization) notFound();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title={organization.name} description="Состояние организации, сотрудники и журнал административных действий. Клиентские кейсы здесь не отображаются." />
      <section className="mt-6 rounded-[14px] bg-white p-5 shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <dl className="grid gap-x-8 gap-y-4 text-[13px] sm:grid-cols-2">
            <Meta label="Статус"><Status status={organization.status} /></Meta>
            <Meta label="Slug">{organization.slug}</Meta>
            <Meta label="Часовой пояс">{organization.timezone}</Meta>
            <Meta label="Создана">{formatDate(organization.createdAt)}</Meta>
          </dl>
          <OrganizationStatusControl organizationId={organization.id} status={organization.status} />
        </div>
      </section>
      <section className="mt-6 rounded-[14px] bg-white p-5 shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        <h2 className="text-[17px] font-semibold">Сотрудники</h2>
        <div className="mt-4 divide-y divide-[#e5e9e7]">
          {organization.memberships.map((membership) => (
            <div key={membership.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_110px_120px_130px] sm:items-center">
              <span><span className="block text-[13px] font-semibold">{membership.user.name ?? "Без имени"}</span><span className="mt-0.5 block text-[12px] text-[#687974]">{membership.user.email ?? "Email не указан"}</span></span>
              <span className="text-[12px] font-semibold">{membership.role}</span>
              <span className="text-[12px] text-[#60716d]">{membership.status}</span>
              <span className="text-[12px] text-[#60716d]">{membership.agent?.status ?? "Без Agent"}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-6 rounded-[14px] bg-white p-5 shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        <h2 className="text-[17px] font-semibold">Последние события организации</h2>
        <div className="mt-4 divide-y divide-[#e5e9e7]">
          {organization.auditEvents.length ? organization.auditEvents.map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-4 py-3">
              <span><span className="block text-[13px] font-semibold">{event.action}</span><span className="mt-0.5 block text-[11px] text-[#71817d]">{event.entityType}</span></span>
              <time className="shrink-0 text-[11px] text-[#71817d]">{formatDate(event.createdAt)}</time>
            </div>
          )) : <p className="py-8 text-center text-[13px] text-[#71817d]">Событий пока нет.</p>}
        </div>
      </section>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-[11px] font-medium text-[#71817d]">{label}</dt><dd className="mt-1.5 font-medium text-[#132421]">{children}</dd></div>;
}
