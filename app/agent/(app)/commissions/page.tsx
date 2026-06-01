import { TrendUp, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { CurrencyRub } from "@phosphor-icons/react/dist/ssr/CurrencyRub";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { moneyFromKopecks, dateLong } from "@/lib/format";

type CommissionRow = { id: number; orderId: number; status: string; amount: number; order?: { id: number; createdAt: Date } | null };
type PayoutRow = { id: number; amount: number; paidAt: Date | null };

async function getCommissions(agentId: number): Promise<{ commissions: CommissionRow[]; payouts: PayoutRow[]; accrued: number; approved: number; paid: number }> {
  try {
    const [commissions, payouts] = await Promise.all([
      prisma.commission.findMany({
        where: { agentId },
        orderBy: { id: "desc" },
        include: { order: { select: { id: true, createdAt: true } } },
      }),
      prisma.payout.findMany({ where: { agentId }, orderBy: { id: "desc" } }),
    ]);
    const accrued = commissions.filter((c) => c.status === "ACCRUED").reduce((sum, c) => sum + c.amount, 0);
    const approved = commissions.filter((c) => c.status === "APPROVED").reduce((sum, c) => sum + c.amount, 0);
    const paid = payouts.reduce((sum, p) => sum + p.amount, 0);
    return { commissions, payouts, accrued, approved, paid };
  } catch {
    return { commissions: [], payouts: [], accrued: 0, approved: 0, paid: 0 };
  }
}

const STATUS_LABELS: Record<string, string> = { ACCRUED: "Начислено", APPROVED: "Подтверждено", PAID: "Выплачено" };
const STATUS_DOT: Record<string, string> = { ACCRUED: "bg-warning", APPROVED: "bg-info", PAID: "bg-success" };

export default async function CommissionsPage() {
  const session = await getAgentSession();
  const { commissions, payouts, accrued, approved, paid } = await getCommissions(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[1040px] px-4 py-7 sm:px-7 sm:py-10">
      <header className="rise mb-8">
        <span className="td-eyebrow">Финансы</span>
        <h1 className="mt-4 font-serif text-[34px] leading-tight text-ink sm:text-[42px]">Комиссии</h1>
      </header>

      {/* Summary */}
      <section className="rise rise-1 mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <SumCard icon={<CurrencyRub size={18} weight="duotone" />} label="К выплате" value={moneyFromKopecks(accrued + approved)} sub="начислено + подтверждено" tone="gold" />
        <SumCard icon={<TrendUp size={18} weight="duotone" />} label="Ожидает" value={moneyFromKopecks(accrued)} sub="ожидает подтверждения" />
        <SumCard icon={<CheckCircle size={18} weight="duotone" />} label="Выплачено" value={moneyFromKopecks(paid)} sub="за всё время" />
      </section>

      {/* Commission history */}
      <section className="rise rise-2 mb-7">
        <p className="mb-3 td-eyebrow">История начислений</p>
        <div className="td-shell overflow-hidden">
          <div className="td-core overflow-hidden">
          {commissions.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CurrencyRub size={30} className="mx-auto mb-2 text-ink-3" />
              <p className="text-[13px] text-ink-2">Начислений пока нет</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {commissions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="tnum block text-[14px] font-medium text-ink">Заказ №{c.orderId}</span>
                    <span className="tnum mt-0.5 block text-[12px] text-ink-3">{dateLong(c.order?.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[c.status] ?? "bg-ink-3"}`} />
                      <span className="hidden sm:inline">{STATUS_LABELS[c.status] ?? c.status}</span>
                    </span>
                    <span className="tnum text-[14px] font-semibold text-ink">{moneyFromKopecks(c.amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      </section>

      {/* Payouts */}
      {payouts.length > 0 && (
        <section className="rise rise-3">
          <p className="mb-3 td-eyebrow">Выплаты</p>
          <div className="td-shell overflow-hidden">
            <div className="td-core overflow-hidden">
            <ul className="divide-y divide-line">
              {payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="tnum block text-[14px] font-medium text-ink">Выплата №{p.id}</span>
                    <span className="tnum mt-0.5 block text-[12px] text-ink-3">{dateLong(p.paidAt)}</span>
                  </span>
                  <span className="tnum text-[14px] font-semibold text-success">{moneyFromKopecks(p.amount)}</span>
                </li>
              ))}
            </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function SumCard({ icon, label, value, sub, tone = "accent" }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: "accent" | "gold" }) {
  const chip = tone === "gold" ? "bg-gold-soft text-gold" : "bg-accent-soft text-accent";
  return (
    <div className="td-shell u-lift">
      <div className="td-core p-5">
      <div className="mb-5 flex items-center justify-between gap-2.5">
        <span className={`grid h-11 w-11 place-items-center rounded-[14px] ${chip}`}>{icon}</span>
        <span className="text-right text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</span>
      </div>
      <div className="tnum mb-2 font-serif text-[30px] font-semibold leading-none text-ink">{value}</div>
      <p className="text-[11.5px] text-ink-3">{sub}</p>
      </div>
    </div>
  );
}
