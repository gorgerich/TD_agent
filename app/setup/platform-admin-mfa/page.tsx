import { redirect } from "next/navigation";
import { getCurrentUserSession } from "@/lib/auth";
import { PlatformMfaSetupClient } from "./PlatformMfaSetupClient";

export const dynamic = "force-dynamic";

export default async function PlatformMfaSetupPage() {
  const user = await getCurrentUserSession();
  if (!user) redirect("/agent/login");
  if (user.platformRole !== "SUPER_ADMIN") redirect("/agent/cases");
  if (user.platformMfaEnabled && user.mfaVerified) redirect("/platform-admin");
  return <PlatformMfaSetupClient />;
}
