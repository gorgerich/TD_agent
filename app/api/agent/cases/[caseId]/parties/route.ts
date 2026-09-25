import { NextResponse } from "next/server";
import { z } from "zod";
import { createCaseParty, listCaseParties } from "@/lib/casePartyService";
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

export async function GET(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const context = await requireAgent(req);
    const caseId = await canonicalCaseIdFromLead(context, (await params).caseId);
    return NextResponse.json({ parties: await listCaseParties(context, caseId) });
  } catch (error) {
    return handleApiError(error, "m3/parties/list");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const context = await requireAgent(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректный участник кейса");
    const caseId = await canonicalCaseIdFromLead(context, (await params).caseId);
    const result = await createCaseParty(context, caseId, {
      ...parsed.data,
      consentAt: parsed.data.consentAt ? new Date(parsed.data.consentAt) : null,
    }, commandMetaFromHeaders(req, "Добавление роли семьи в кейс"));
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "m3/parties/create");
  }
}
