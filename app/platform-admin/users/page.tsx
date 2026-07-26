import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { PageHeader } from "../page";

export const dynamic = "force-dynamic";

export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { id: "desc" },
    take: 50,
    select: {
      id: true, name: true, email: true, platformRole: true,
      agent: { select: { status: true } },
      memberships: { select: { role: true, status: true, organization: { select: { name: true, status: true } } } },
    },
  });
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Пользователи" description="Учетные записи и рабочие членства. Пароли, токены и содержимое клиентских данных не выдаются." />
      <form className="mt-6 flex gap-3 rounded-[12px] bg-white p-3 shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        <input name="q" defaultValue={q} placeholder="Имя или email" aria-label="Поиск пользователей" className="min-h-11 min-w-0 flex-1 rounded-[9px] bg-[#f3f5f4] px-3 text-[13px]" />
        <button className="min-h-11 rounded-[9px] bg-[#0d2f2a] px-5 text-[13px] font-semibold text-white">Найти</button>
      </form>
      <div className="mt-5 overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(13,47,42,0.08)]">
        {users.length ? users.map((user) => (
          <div key={user.id} className="grid gap-2 border-b border-[#e5e9e7] px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(220px,1fr)_150px_170px_minmax(220px,1fr)] lg:items-center">
            <span><span className="block text-[13px] font-semibold">{user.name ?? "Без имени"}</span><span className="mt-0.5 block text-[12px] text-[#687974]">{user.email ?? "Email не указан"}</span></span>
            <span className="text-[12px] font-semibold">{user.platformRole}</span>
            <span className="text-[12px] text-[#60716d]">{user.agent?.status ?? "Без Agent"}</span>
            <span className="text-[12px] leading-5 text-[#60716d]">{user.memberships.length ? user.memberships.map((membership) => `${membership.organization.name}: ${membership.role} / ${membership.status}`).join(" · ") : "Нет membership"}</span>
          </div>
        )) : <p className="px-5 py-16 text-center text-[13px] text-[#71817d]">Пользователи не найдены.</p>}
      </div>
    </div>
  );
}
