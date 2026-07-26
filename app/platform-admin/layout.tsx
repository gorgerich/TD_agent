import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserSession } from "@/lib/auth";
import { getPlatformContext } from "@/lib/platformAuth";
import { PlatformAdminShell } from "./PlatformAdminShell";

export const dynamic = "force-dynamic";

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserSession();
  if (!user) redirect("/agent/login");
  const context = await getPlatformContext();
  if (!context) {
    return (
      <main id="main-content" className="grid min-h-[100dvh] place-items-center bg-canvas px-5">
        <section className="max-w-[520px] text-center">
          <p className="text-[13px] font-semibold text-danger">403</p>
          <h1 className="mt-3 text-[28px] font-semibold text-ink">Нет доступа к администрированию платформы</h1>
          <p className="mt-3 text-[14px] leading-6 text-ink-2">Этот раздел доступен только владельцу платформы. Рабочие роли организации не дают глобальных прав.</p>
          {user.hasOperationalAccess && <Link href="/agent/cases" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-[13px] font-semibold text-on-accent">Вернуться в рабочее пространство</Link>}
        </section>
      </main>
    );
  }
  return <PlatformAdminShell name={context.name} hasWorkspace={context.hasOperationalAccess}>{children}</PlatformAdminShell>;
}
