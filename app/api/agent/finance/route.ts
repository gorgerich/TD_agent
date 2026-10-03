import { NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { listFinanceWorkspace } from "@/lib/contractLedgerService";

export async function GET(req: Request) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["FINANCE"] });
    return NextResponse.json(await listFinanceWorkspace(context));
  } catch (error) {
    return handleApiError(error, "m3/finance/workspace");
  }
}
