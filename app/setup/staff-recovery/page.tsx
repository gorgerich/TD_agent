import type { Metadata } from "next";
import { StaffRecoveryClient } from "./StaffRecoveryClient";

export const metadata: Metadata = {
  title: "Восстановление доступа сотрудника | Тихий дом",
  robots: { index: false, follow: false }, referrer: "no-referrer",
};

export default function StaffRecoveryPage() { return <StaffRecoveryClient />; }
