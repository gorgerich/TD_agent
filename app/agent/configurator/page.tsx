import { redirect } from "next/navigation";
import { getAgentSession } from "@/lib/auth";
import RitualConfigurator from "@/components/configurator/RitualConfigurator";

export const metadata = { title: "Конфигуратор - Тихий дом" };

export default async function ConfiguratorPage() {
  const session = await getAgentSession();
  if (!session && process.env.NODE_ENV !== "development") redirect("/agent/login");

  return <RitualConfigurator mode="page" />;
}
