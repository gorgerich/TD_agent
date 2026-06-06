import { GearSix } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await getAgentSession();

  return (
    <div className="td-page mx-auto max-w-[860px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-6">
        <span className="td-eyebrow">Профиль</span>
        <h1 className="mt-2 text-[30px] font-semibold leading-tight text-ink sm:text-[36px]">Настройки</h1>
      </header>

      <section className="rise rise-1 td-shell p-5">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-accent-soft text-accent">
            <GearSix size={22} weight="duotone" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold text-ink">Агентский профиль</h2>
            <p className="text-[13px] text-ink-3">MVP-настройки без изменения backend.</p>
          </div>
        </div>
        <div className="divide-y divide-line rounded-[12px] border border-line bg-surface">
          <Row label="Имя" value={session?.name ?? "—"} />
          <Row label="Роль" value={session?.role ?? "—"} />
          <Row label="Agent ID" value={String(session?.agentId ?? "—")} last />
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${last ? "" : "border-b border-line"}`}>
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="text-right text-[13.5px] font-medium text-ink">{value}</span>
    </div>
  );
}
