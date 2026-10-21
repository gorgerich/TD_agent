import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { PageHeader } from "../../page";
import { StaffRecoveryControl } from "./StaffRecoveryControl";

export const dynamic = "force-dynamic";

export default async function PlatformUserPage({ params }: { params: Promise<{ userId: string }> }) {
  await requirePlatformAdmin();
  const { userId: raw } = await params;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 2_147_483_647) notFound();
  const user = await prisma.user.findUnique({ where: { id: Number(raw) }, select: {
    id: true, name: true, platformRole: true,
    memberships: { where: { status: "ACTIVE", organization: { status: "ACTIVE" }, agent: { status: "ACTIVE" } },
      select: { id: true, organizationId: true, role: true, organization: { select: { name: true } } } },
  } });
  if (!user) notFound();
  return <div className="mx-auto max-w-[1100px]">
    <PageHeader title={user.name ?? `Пользователь ${user.id}`} description={user.platformRole} />
    {user.platformRole === "USER" && user.memberships.length > 0 ? <StaffRecoveryControl memberships={user.memberships.map((m) => ({
      id: m.id, organizationId: m.organizationId, label: `${m.organization.name}: ${m.role}`,
    }))} /> : <p className="mt-6 text-sm">Восстановление сотрудника недоступно для этой учётной записи.</p>}
  </div>;
}
