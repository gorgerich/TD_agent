import { redirect } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import { operationalLanding } from "@/lib/operationalAuth";

export default async function DashboardPage() {
  const session = await getAgentSession();
  redirect(session ? operationalLanding(session.role) : "/agent/login");
}
