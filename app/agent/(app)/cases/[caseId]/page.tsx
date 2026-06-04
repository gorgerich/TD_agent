import { redirect } from "next/navigation";

// Временный мост: страница дела (timeline + чеклист + активность) — этап P2.
// Пока ведём на существующую карточку клиента, чтобы ссылки из списка дел
// работали без поломок.
export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  redirect(`/agent/leads/${caseId}`);
}
