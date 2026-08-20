import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { createContractVersion, issueContractVersion, signContractVersion } from "@/lib/contractLedgerService";
import { canonicalCaseIdFromLead, commandMetaFromHeaders } from "@/lib/m3Api";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE"),
    payerPartyId: z.string().min(1).max(120),
    paymentTerms: z.record(z.string().min(1).max(120), z.unknown()),
    validUntil: z.string().datetime().nullable().optional(),
  }),
  z.object({ action: z.literal("ISSUE"), contractVersionId: z.string().min(1).max(120) }),
  z.object({
    action: z.literal("SIGN"),
    contractVersionId: z.string().min(1).max(120),
    signatureEvidence: z.object({ type: z.string().trim().min(1).max(80), reference: z.string().trim().min(3).max(240) }),
    signaturePolicyVersion: z.string().trim().min(1).max(80),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const context = await requireAgent(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректная команда договора");
    const meta = commandMetaFromHeaders(req, "Изменение lifecycle договора");
    if (parsed.data.action === "CREATE") {
      const caseId = await canonicalCaseIdFromLead(context, (await params).caseId);
      return NextResponse.json(await createContractVersion(context, {
        caseId,
        payerPartyId: parsed.data.payerPartyId,
        paymentTerms: parsed.data.paymentTerms,
        validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      }, meta));
    }
    if (parsed.data.action === "ISSUE") {
      return NextResponse.json(await issueContractVersion(context, parsed.data.contractVersionId, meta));
    }
    return NextResponse.json(await signContractVersion(context, parsed.data, meta));
  } catch (error) {
    return handleApiError(error, "m3/contracts");
  }
}
