import { NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { canonicalCaseIdFromLead } from "@/lib/m3Api";
import { reconcileM3Case } from "@/lib/m3Reconciliation";

export async function GET(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const context = await requireAgent(req);
    const caseId = await canonicalCaseIdFromLead(context, (await params).caseId);
    return NextResponse.json(await reconcileM3Case(context, caseId));
  } catch (error) {
    return handleApiError(error, "m3/reconciliation");
  }
}
