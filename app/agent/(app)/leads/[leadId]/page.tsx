import { redirect } from "next/navigation";

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  redirect(`/agent/cases/${leadId}`);
}
