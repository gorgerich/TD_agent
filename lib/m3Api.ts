import { prisma } from "@/lib/prisma";
import { parseId } from "@/lib/apiAuth";
import { hasTeamOperationalScope, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import type { M3CommandMeta } from "@/lib/m3Command";

export async function canonicalCaseIdFromLead(context: OperationalContext, rawLeadId: string): Promise<string> {
  const leadId = parseId(rawLeadId, "caseId");
  const record = await prisma.case.findFirst({
    where: {
      leadId,
      tenantId: context.organizationId,
      ...(!hasTeamOperationalScope(context.role) ? { ownerId: context.agentId } : {}),
    },
    select: { id: true },
  });
  if (!record) throw new OperationalCommandError(404, "Кейс не найден");
  return record.id;
}

export function commandMetaFromHeaders(req: Request, fallbackReason?: string): M3CommandMeta {
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  const correlationId = req.headers.get("x-correlation-id")?.trim();
  if (!idempotencyKey || !correlationId) {
    throw new OperationalCommandError(400, "Нужны Idempotency-Key и X-Correlation-Id");
  }
  return { idempotencyKey, correlationId, reason: fallbackReason };
}
