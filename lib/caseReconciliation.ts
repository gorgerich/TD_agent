import type { CaseStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CASE_STAGES } from "@/lib/caseDomain";
import { tenantIdForAgent } from "@/lib/caseService";
import { hasTeamOperationalScope, type OperationalContext } from "@/lib/operationalAuth";

export type CaseReconciliationIssue = {
  code: "MISSING_CASE" | "TENANT_OWNER_MISMATCH" | "STAGE_BEHIND_ARTIFACTS" | "DOCUMENT_TENANT_MISMATCH";
  leadId: number;
  detail: string;
};

export type CaseReconciliationReport = {
  tenantId: string;
  leadCount: number;
  caseCount: number;
  documentCount: number;
  issues: CaseReconciliationIssue[];
  discrepancyCount: number;
};

export async function reconcileCaseState(scope: number | OperationalContext): Promise<CaseReconciliationReport> {
  const legacy = typeof scope === "number";
  const agentId = legacy ? scope : scope.agentId;
  const tenantId = legacy ? tenantIdForAgent(agentId) : scope.organizationId;
  const agentIds = legacy || !hasTeamOperationalScope(scope.role)
    ? [agentId]
    : (await prisma.membership.findMany({
        where: { organizationId: tenantId, agentId: { not: null } },
        select: { agentId: true },
      })).flatMap((membership) => membership.agentId == null ? [] : [membership.agentId]);
  const leads = await prisma.clientLead.findMany({
    where: { agentId: { in: agentIds } },
    select: {
      id: true,
      agentId: true,
      case: { select: { tenantId: true, ownerId: true, stage: true, publishedQuoteVersionId: true } },
      documents: { select: { agentId: true } },
      meetings: {
        select: {
          quotes: { select: { versions: { select: { id: true } } } },
          orders: { select: { status: true } },
        },
      },
    },
  });
  const issues: CaseReconciliationIssue[] = [];

  for (const lead of leads) {
    if (!lead.case) {
      issues.push({ code: "MISSING_CASE", leadId: lead.id, detail: "ClientLead не имеет canonical Case" });
      continue;
    }
    if (lead.case.tenantId !== tenantId || lead.case.ownerId !== lead.agentId) {
      issues.push({ code: "TENANT_OWNER_MISMATCH", leadId: lead.id, detail: "Case tenant/owner не совпадает с владельцем ClientLead" });
    }
    if (lead.documents.some((document) => document.agentId !== lead.agentId)) {
      issues.push({ code: "DOCUMENT_TENANT_MISMATCH", leadId: lead.id, detail: "Document owner не совпадает с tenant кейса" });
    }
    const minimumStage = inferMinimumStage(lead);
    if (stageRank(lead.case.stage) < stageRank(minimumStage)) {
      issues.push({
        code: "STAGE_BEHIND_ARTIFACTS",
        leadId: lead.id,
        detail: `Case ${lead.case.stage}, но связанные артефакты требуют минимум ${minimumStage}`,
      });
    }
  }

  const documentCount = leads.reduce((total, lead) => total + lead.documents.length, 0);
  const caseCount = leads.filter((lead) => lead.case).length;
  return { tenantId, leadCount: leads.length, caseCount, documentCount, issues, discrepancyCount: issues.length };
}

type ReconciliationLead = {
  case: { publishedQuoteVersionId: number | null } | null;
  meetings: Array<{
    quotes: Array<{ versions: Array<{ id: number }> }>;
    orders: Array<{ status: string }>;
  }>;
};

export function inferMinimumStage(lead: ReconciliationLead): CaseStage {
  const statuses = lead.meetings.flatMap((meeting) => meeting.orders.map((order) => order.status.toUpperCase()));
  if (statuses.some((status) => ["PAID", "COMPLETED"].includes(status)) && lead.case?.publishedQuoteVersionId) return "EXECUTION";
  if (statuses.some((status) => ["SIGNED", "PARTIALLY_PAID"].includes(status)) && lead.case?.publishedQuoteVersionId) return "PAYMENT";
  if (statuses.length > 0 && lead.case?.publishedQuoteVersionId) return "CONTRACTING";
  if (lead.case?.publishedQuoteVersionId) return "AGREEMENT";
  if (lead.meetings.some((meeting) => meeting.quotes.some((quote) => quote.versions.length > 0))) return "QUOTING";
  if (lead.meetings.length > 0) return "PLANNING";
  return "INTAKE";
}

function stageRank(stage: CaseStage): number {
  return CASE_STAGES.indexOf(stage);
}
