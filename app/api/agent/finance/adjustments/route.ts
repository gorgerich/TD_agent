import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { requestLedgerAdjustment } from "@/lib/contractLedgerService";
import { commandMetaFromHeaders } from "@/lib/m3Api";

const Body = z.object({
  type: z.enum(["CORRECTION", "REVERSAL"]),
  relatedEntryId: z.string().min(1).max(120),
  direction: z.enum(["DEBIT", "CREDIT"]),
  amountKopecks: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.string().datetime(),
  evidenceReference: z.string().trim().min(3).max(240),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(req: Request) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["FINANCE"] });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректная коррекция");
    const result = await requestLedgerAdjustment(context, {
      ...parsed.data,
      occurredAt: new Date(parsed.data.occurredAt),
    }, commandMetaFromHeaders(req, parsed.data.reason));
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "m3/finance/adjustment");
  }
}
