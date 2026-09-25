import { NextResponse } from "next/server";
import { z } from "zod";
import { updateCaseParty } from "@/lib/casePartyService";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { canonicalCaseIdFromLead, commandMetaFromHeaders } from "@/lib/m3Api";

const Body = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().max(240).nullable().optional(),
  roles: z.array(z.enum(["APPLICANT", "DECISION_MAKER", "PAYER", "RESPONSIBLE_FOR_BURIAL", "ADDITIONAL_CONTACT"])).min(1),
  preferredChannel: z.enum(["PHONE", "EMAIL", "MESSENGER", "IN_PERSON", "NONE"]),
  consentStatus: z.enum(["UNKNOWN", "NOT_REQUESTED", "GRANTED", "WITHDRAWN", "RESTRICTED"]),
  consentSource: z.string().trim().max(240).nullable().optional(),
  consentAt: z.string().datetime().nullable().optional(),
  visibilityPolicy: z.enum(["CASE_TEAM", "FINANCE_LIMITED", "REVIEWER_REDACTED"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ caseId: string; partyId: string }> },
) {
  try {
    const context = await requireAgent(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректный участник кейса");
    const route = await params;
    const caseId = await canonicalCaseIdFromLead(context, route.caseId);
    return NextResponse.json(await updateCaseParty(context, caseId, route.partyId, {
      ...parsed.data,
      consentAt: parsed.data.consentAt ? new Date(parsed.data.consentAt) : null,
    }, commandMetaFromHeaders(req, "Изменение роли или согласия участника кейса")));
  } catch (error) {
    return handleApiError(error, "m3/parties/update");
  }
}
