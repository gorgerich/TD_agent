import type { Metadata } from "next";
import { PlatformOwnerRecoveryClient } from "./PlatformOwnerRecoveryClient";

export const metadata: Metadata = {
  title: "Восстановление доступа владельца | Тихий дом",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PlatformOwnerRecoveryPage() {
  return <PlatformOwnerRecoveryClient />;
}
