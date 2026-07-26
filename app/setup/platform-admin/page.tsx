import type { Metadata } from "next";
import { PlatformActivationClient } from "./PlatformActivationClient";

export const metadata: Metadata = {
  title: "Активация владельца платформы | Тихий дом",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PlatformAdminSetupPage() {
  return <PlatformActivationClient />;
}
