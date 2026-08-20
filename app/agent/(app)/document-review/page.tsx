import { notFound } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import { listDocumentReviewQueue } from "@/lib/documentService";
import { DocumentReviewClient } from "./DocumentReviewClient";

export default async function DocumentReviewPage() {
  const session = await getAgentSession();
  if (!session || session.role !== "DOCUMENT_REVIEWER") notFound();
  const queue = await listDocumentReviewQueue(session);
  return (
    <DocumentReviewClient
      membershipId={session.membershipId}
      timezone={session.timezone}
      initial={queue.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        requirement: item.requirement ? {
          ...item.requirement,
          dueAt: item.requirement.dueAt?.toISOString() ?? null,
          reviewChecklist: Array.isArray(item.requirement.reviewChecklist)
            ? item.requirement.reviewChecklist.filter((value): value is string => typeof value === "string")
            : [],
        } : null,
      }))}
    />
  );
}
