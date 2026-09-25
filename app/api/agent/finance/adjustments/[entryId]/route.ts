import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { decideLedgerAdjustment } from "@/lib/contractLedgerService";
import { commandMetaFromHeaders } from "@/lib/m3Api";

const Body = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["FINANCE"] });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректное решение");
    return NextResponse.json(await decideLedgerAdjustment(context, {
      ledgerEntryId: (await params).entryId,
      ...parsed.data,
    }, commandMetaFromHeaders(req, parsed.data.reason)));
  } catch (error) {
    return handleApiError(error, "m3/finance/adjustment-decision");
  }
}
