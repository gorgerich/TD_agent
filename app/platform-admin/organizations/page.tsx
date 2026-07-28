import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { PageHeader, formatDate } from "../page";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const status = params.status === "SUSPENDED" ? "SUSPENDED" : params.status === "ACTIVE" ? "ACTIVE" : "ALL";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const pageSize = 25;
  const where: Prisma.OrganizationWhereInput = {
    ...(status === "ALL" ? {} : { status }),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [organizations, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        memberships: { where: { status: "ACTIVE" }, select: { role: true } },
      },
    }),
    prisma.organization.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status !== "ALL") query.set("status", status);
    query.set("page", String(nextPage));
    return `/platform-admin/organizations?${query.toString()}`;
  };

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title="Организации" description="Структура агентств, состав ролей и состояние рабочего доступа." />
      <form className="mt-6 flex flex-col gap-3 rounded-[12px] bg-white p-3 shadow-[0_1px_2px_rgba(13,47,42,0.08)] sm:flex-row">
        <input name="q" defaultValue={q} placeholder="Название или slug" aria-label="Поиск организаций" className="min-h-11 min-w-0 flex-1 rounded-[9px] bg-[#f3f5f4] px-3 text-[13px] outline-none focus:ring-2 focus:ring-[#176b5d]/25" />
        <select name="status" defaultValue={status} aria-label="Статус организации" className="min-h-11 rounded-[9px] bg-[#f3f5f4] px-3 text-[13px]">
          <option value="ALL">Все статусы</option>
          <option value="ACTIVE">Активные</option>
          <option value="SUSPENDED">Приостановленные</option>
        </select>
        <button className="min-h-11 rounded-[9px] bg-[#0d2f2a] px-5 text-[13px] font-semibold text-white">Применить</button>
      </form>

      <div className="mt-5 overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        <div className="hidden grid-cols-[minmax(220px,1.5fr)_140px_110px_110px_110px_130px] gap-4 border-b border-[#e5e9e7] px-5 py-3 text-[11px] font-semibold text-[#687974] lg:grid">
          <span>Организация</span><span>Статус</span><span>ADMIN</span><span>MANAGER</span><span>AGENT</span><span>Создана</span>
        </div>
        {organizations.length ? organizations.map((organization) => {
          const count = (role: string) => organization.memberships.filter((membership) => membership.role === role).length;
          return (
            <Link key={organization.id} href={`/platform-admin/organizations/${organization.id}`} className="grid gap-2 border-b border-[#e5e9e7] px-5 py-4 last:border-b-0 hover:bg-[#f8faf9] lg:grid-cols-[minmax(220px,1.5fr)_140px_110px_110px_110px_130px] lg:items-center lg:gap-4">
              <span><span className="block text-[13px] font-semibold">{organization.name}</span><span className="mt-1 block text-[11px] text-[#71817d]">{organization.slug}</span></span>
              <Status status={organization.status} />
              <Data label="ADMIN" value={count("ADMIN")} />
              <Data label="MANAGER" value={count("MANAGER")} />
              <Data label="AGENT" value={count("AGENT")} />
              <time className="text-[12px] text-[#60716d]">{formatDate(organization.createdAt)}</time>
            </Link>
          );
        }) : <p className="px-5 py-16 text-center text-[13px] text-[#71817d]">Организации не найдены. Измените фильтры.</p>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-[12px] text-[#71817d]">Страница {Math.min(page, pages)} из {pages} · {total} организаций</p>
        <nav aria-label="Страницы организаций" className="flex gap-2">
          {page > 1 && <Link href={pageHref(page - 1)} className="inline-flex min-h-10 items-center px-3 text-[12px] font-semibold text-[#176b5d]">Назад</Link>}
          {page < pages && <Link href={pageHref(page + 1)} className="inline-flex min-h-10 items-center px-3 text-[12px] font-semibold text-[#176b5d]">Далее</Link>}
        </nav>
      </div>
    </div>
  );
}

export function Status({ status }: { status: "ACTIVE" | "SUSPENDED" }) {
  return <span className={`inline-flex w-fit rounded-[7px] px-2 py-1 text-[11px] font-semibold ${status === "ACTIVE" ? "bg-[#e5f1ec] text-[#176b5d]" : "bg-[#f7ead7] text-[#875a19]"}`}>{status === "ACTIVE" ? "Активна" : "Приостановлена"}</span>;
}

function Data({ label, value }: { label: string; value: number }) {
  return <span className="text-[12px] text-[#60716d]"><span className="mr-2 text-[10px] font-semibold text-[#71817d] lg:hidden">{label}</span>{value}</span>;
}
