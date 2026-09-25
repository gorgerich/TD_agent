import { redirect } from "next/navigation";
import { getCurrentUserSession } from "@/lib/auth";
import { PlatformMfaSetupClient } from "./PlatformMfaSetupClient";

export const dynamic = "force-dynamic";

export default async function PlatformMfaSetupPage() {
  const user = await getCurrentUserSession();
  if (!user) redirect("/agent/login");
  const finance = user.activeMembershipRole === "FINANCE";
  if (user.platformRole !== "SUPER_ADMIN" && !finance) redirect("/agent/cases");
  const redirectTo = user.platformRole === "SUPER_ADMIN" ? "/platform-admin" : "/agent/finance";
  if (user.platformMfaEnabled && user.mfaVerified) redirect(redirectTo);
  return <PlatformMfaSetupClient purpose={finance && user.platformRole !== "SUPER_ADMIN" ? "FINANCE" : "PLATFORM"} redirectTo={redirectTo} />;
}
