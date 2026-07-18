import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { getOperationsQueue, getTeamControlTower } from "@/lib/operationsReadModel";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    const view = new URL(req.url).searchParams.get("view") ?? "mine";
    if (view === "team") return NextResponse.json(await getTeamControlTower(session));
    return NextResponse.json(await getOperationsQueue(session));
  } catch (error) {
    return handleApiError(error, "operations/read");
  }
}
