import { UserCircle } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "./SettingsClient";

async function getNotify(agentId: number): Promise<boolean> {
  try {
    const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { notifyEnabled: true } });
    return a?.notifyEnabled ?? true;
  } catch {
    return true;
  }
}

export default async function SettingsPage() {
  const session = await getAgentSession();
  const notifyEnabled = await getNotify(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[860px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-6">
        <span className="td-eyebrow">Профиль</span>
        <h1 className="td-display mt-2 text-[30px] text-ink sm:text-[36px]">Настройки</h1>
      </header>

      <section className="rise rise-1 td-shell p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-[12px] icon-3d text-accent">
            <UserCircle size={22} weight="duotone" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold text-ink">Агентский профиль</h2>
            <p className="text-[13px] text-ink-3">{session?.role ?? "AGENT"} · ID {session?.agentId ?? "—"}</p>
          </div>
        </div>
        <div className="divide-y divide-line rounded-[12px] border border-line bg-surface">
          <Row label="Имя" value={session?.name ?? "—"} />
          <Row label="Роль" value={session?.role ?? "—"} last />
        </div>
      </section>

      <SettingsClient notifyEnabled={notifyEnabled} />
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${last ? "" : "border-b border-line"}`}>
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="text-right text-[13px] font-medium text-ink">{value}</span>
    </div>
  );
}
