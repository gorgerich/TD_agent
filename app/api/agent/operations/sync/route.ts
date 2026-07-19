import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { ensurePastMeetingEscalations } from "@/lib/operationsProjection";
import { reconcileOperations } from "@/lib/operationsReconciliation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, "work:mutate-own");
    const projection = await ensurePastMeetingEscalations(session);
    const reconciliation = await reconcileOperations(session.organizationId);
    return NextResponse.json({ projection, reconciliation });
  } catch (error) {
    return handleApiError(error, "operations/sync");
  }
}
