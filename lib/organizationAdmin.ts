import type { MembershipRole, Prisma } from "@prisma/client";
import { OperationalCommandError } from "@/lib/operationalTransaction";

export const ADMIN_CONFIRMATION = "НАЗНАЧИТЬ АДМИНИСТРАТОРА";

export function assertAdminRoleConfirmation(role: MembershipRole, confirmation?: string): void {
  if (role === "ADMIN" && confirmation !== ADMIN_CONFIRMATION) {
    throw new OperationalCommandError(
      422,
      `Для назначения ADMIN введите «${ADMIN_CONFIRMATION}»`,
      "ADMIN_CONFIRMATION_REQUIRED",
    );
  }
}

export async function assertNotLastActiveAdmin(
  tx: Prisma.TransactionClient,
  membership: { id: string; organizationId: string; role: MembershipRole; status: "INVITED" | "ACTIVE" | "SUSPENDED" },
  next: { role?: MembershipRole; status?: "ACTIVE" | "SUSPENDED" },
): Promise<void> {
  if (membership.role !== "ADMIN" || membership.status !== "ACTIVE") return;
  const remainsAdmin = (next.role ?? membership.role) === "ADMIN" && (next.status ?? membership.status) === "ACTIVE";
  if (remainsAdmin) return;

  const activeAdmins = await tx.membership.count({
    where: {
      organizationId: membership.organizationId,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  if (activeAdmins <= 1) {
    throw new OperationalCommandError(
      409,
      "Нельзя изменить последнего активного администратора организации",
      "LAST_ACTIVE_ADMIN",
    );
  }
}
