import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TeamAccessClient, type TeamSnapshot } from "./TeamAccessClient";

export default async function TeamSettingsPage() {
  const session = await getAgentSession();
  if (!session) redirect("/agent/login");
  if (session.role !== "ADMIN") {
    return (
      <div className="td-page mx-auto max-w-[760px] px-4 py-8 sm:px-7">
        <section className="td-shell px-6 py-12 text-center">
          <p className="text-[12px] font-semibold text-danger">403</p>
          <h1 className="mt-3 text-[24px] font-semibold text-ink">Недостаточно прав</h1>
          <p className="mx-auto mt-2 max-w-[46ch] text-[13px] leading-6 text-ink-2">
            Управлять сотрудниками и приглашениями может только администратор организации.
          </p>
          <Link href="/agent/settings" className="mt-6 inline-flex min-h-11 items-center text-[13px] font-semibold text-accent">
            Вернуться в настройки
          </Link>
        </section>
      </div>
    );
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: {
      id: true,
      name: true,
      memberships: {
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { name: true, email: true } },
        },
      },
      invitations: {
        where: { acceptedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          emailNormalized: true,
          role: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
      },
    },
  });

  const snapshot: TeamSnapshot = {
    id: organization.id,
    name: organization.name,
    generatedAt: new Date().toISOString(),
    memberships: organization.memberships.map((membership) => ({
      ...membership,
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
    })),
    invitations: organization.invitations.map((invite) => ({
      ...invite,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      revokedAt: invite.revokedAt?.toISOString() ?? null,
    })),
  };

  return (
    <div className="td-page mx-auto max-w-[1040px] px-4 py-6 sm:px-7 sm:py-8">
      <Link href="/agent/settings" className="inline-flex min-h-10 items-center gap-2 text-[12px] font-semibold text-ink-3 hover:text-ink">
        <ArrowLeft size={16} weight="bold" />
        Настройки
      </Link>
      <header className="mt-3 max-w-[680px]">
        <h1 className="td-display text-[30px] text-ink sm:text-[36px]">Команда и доступы</h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-2">
          Управляйте рабочими ролями {organization.name}. Глобальные права платформы здесь недоступны.
        </p>
      </header>
      <TeamAccessClient initial={snapshot} currentMembershipId={session.membershipId} />
    </div>
  );
}
