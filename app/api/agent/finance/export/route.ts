import { NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { listFinanceWorkspace } from "@/lib/contractLedgerService";

export async function GET(req: Request) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["FINANCE"] });
    const workspace = await listFinanceWorkspace(context);
    const rows = [
      ["case", "contract_version", "currency", "obligation_kopecks", "paid_kopecks", "refunded_kopecks", "balance_kopecks", "status"],
      ...workspace.obligations.map((item) => [
        item.case.publicRef,
        String(item.contractVersion.versionNumber),
        item.currency,
        String(item.amountKopecks),
        item.summary.paidKopecks == null ? "" : String(item.summary.paidKopecks),
        item.summary.refundedKopecks == null ? "" : String(item.summary.refundedKopecks),
        item.summary.balanceKopecks == null ? "" : String(item.summary.balanceKopecks),
        item.summary.status ?? item.summary.state,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=finance-reconciliation.csv",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error, "m3/finance/export");
  }
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
