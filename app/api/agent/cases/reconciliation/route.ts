import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { reconcileCaseState } from "@/lib/caseReconciliation";
import { handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await reconcileCaseState(session.agentId));
  } catch (error) {
    return handleApiError(error, "cases/reconciliation");
  }
}
