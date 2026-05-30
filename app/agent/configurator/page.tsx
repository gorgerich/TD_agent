import { redirect } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import ConfiguratorClient from "@/components/configurator/ConfiguratorClient";

export const metadata = { title: "Конфигуратор — Тихий дом" };

export default async function ConfiguratorPage({
  searchParams,
}: {
  searchParams: Promise<{ meeting?: string }>;
}) {
  const session = await getAgentSession();
  if (!session && process.env.NODE_ENV !== "development") redirect("/agent/login");

  const sp = await searchParams;
  const meetingId = sp?.meeting ? Number(sp.meeting) : undefined;

  return <ConfiguratorClient meetingId={Number.isInteger(meetingId) ? meetingId : undefined} />;
}
