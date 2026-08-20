import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { listCaseContractAndLedger, recordManualPayment } from "@/lib/contractLedgerService";
import { canonicalCaseIdFromLead, commandMetaFromHeaders } from "@/lib/m3Api";

const Body = z.object({
  obligationId: z.string().min(1).max(120),
  payerPartyId: z.string().min(1).max(120),
  amountKopecks: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("RUB"),
  occurredAt: z.string().datetime(),
  method: z.enum(["CASH", "SBP_QR", "CARD", "BANK_TRANSFER"]),
  evidenceReference: z.string().trim().min(3).max(240),
  reason: z.string().trim().min(3).max(500),
});

export async function GET(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const context = await requireAgent(req, {
      allowedRoles: ["AGENT", "MANAGER", "ADMIN", "FINANCE"],
    });
    const caseId = await canonicalCaseIdFromLead(context, (await params).caseId);
    return NextResponse.json(await listCaseContractAndLedger(context, caseId));
  } catch (error) {
    return handleApiError(error, "m3/payments/read");
  }
}

export async function POST(req: Request) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["FINANCE"] });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректная оплата");
    const result = await recordManualPayment(context, {
      ...parsed.data,
      occurredAt: new Date(parsed.data.occurredAt),
    }, commandMetaFromHeaders(req, parsed.data.reason));
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "m3/payments/record");
  }
}
