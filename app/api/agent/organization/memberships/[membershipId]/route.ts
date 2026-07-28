import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { assertCapability } from "@/lib/operationalAuth";
import { ADMIN_CONFIRMATION, assertAdminRoleConfirmation, assertNotLastActiveAdmin } from "@/lib/organizationAdmin";
import { runOperationalTransaction } from "@/lib/operationalTransaction";

const Body = z.object({
  role: z.enum(["AGENT", "MANAGER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  confirmation: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(3).max(240),
}).refine((value) => value.role || value.status, "Укажите изменение");

export async function PATCH(req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  try {
    const context = await requireAgent(req, { allowAdminMutation: true });
    assertCapability(context, "membership:manage");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");
    if (parsed.data.role) assertAdminRoleConfirmation(parsed.data.role, parsed.data.confirmation);
    const { membershipId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");

    const result = await runOperationalTransaction(async (tx) => {
      const replay = await tx.operationalAuditEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey } },
      });
      if (replay) return { replayed: true, result: replay.result };

      const membership = await tx.membership.findFirst({
        where: { id: membershipId, organizationId: context.organizationId },
        select: { id: true, organizationId: true, role: true, status: true, agentId: true },
      });
      if (!membership) return null;
      await assertNotLastActiveAdmin(tx, membership, parsed.data);

      const nextRole = parsed.data.role ?? membership.role;
      const nextStatus = parsed.data.status ?? membership.status;
      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { role: nextRole, status: nextStatus },
        select: { id: true, role: true, status: true },
      });
      if (membership.agentId && parsed.data.status) {
        await tx.agent.update({
          where: { id: membership.agentId },
          data: { status: parsed.data.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED" },
        });
      }
      const roleChanged = membership.role !== updated.role;
      const statusChanged = membership.status !== updated.status;
      const action = roleChanged
        ? "MEMBERSHIP_ROLE_CHANGED"
        : updated.status === "SUSPENDED"
          ? "MEMBERSHIP_SUSPENDED"
          : "MEMBERSHIP_REACTIVATED";
      await appendOperationalAudit(tx, context, {
        entityType: "membership",
        entityId: membership.id,
        action,
        before: { role: membership.role, status: membership.status },
        after: { role: updated.role, status: updated.status },
        reason: parsed.data.reason,
        correlationId,
        idempotencyKey,
        result: updated,
      });
      return { replayed: false, result: updated, statusChanged };
    });
    if (!result) return jsonError(404, "Сотрудник не найден");
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, "organization/membership");
  }
}

export { ADMIN_CONFIRMATION };
