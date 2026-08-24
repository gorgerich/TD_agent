import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import { listFinanceWorkspace } from "@/lib/contractLedgerService";
import { FinanceClient } from "./FinanceClient";

export const metadata: Metadata = {
  title: "Финансы | Тихий дом",
};

export default async function FinancePage() {
  const session = await getAgentSession();
  if (!session || session.role !== "FINANCE") notFound();
  const workspace = await listFinanceWorkspace(session);
  return (
    <FinanceClient
      membershipId={session.membershipId}
      timezone={session.timezone}
      initial={{
        obligations: workspace.obligations.map((obligation) => ({
          ...obligation,
          createdAt: obligation.createdAt.toISOString(),
          contractVersion: {
            ...obligation.contractVersion,
            signedAt: obligation.contractVersion.signedAt?.toISOString() ?? null,
          },
          ledgerEntries: obligation.ledgerEntries.map((entry) => ({
            ...entry,
            occurredAt: entry.occurredAt.toISOString(),
          })),
        })),
        pendingApprovals: workspace.pendingApprovals.map((approval) => ({
          ...approval,
          createdAt: approval.createdAt.toISOString(),
        })),
      }}
    />
  );
}
