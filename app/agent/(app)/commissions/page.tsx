import { CurrencyDollar, TrendUp, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

function money(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(kopecks / 100);
}

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
}

const STATUS_LABELS: Record<string, string> = { ACCRUED: "Начислено", APPROVED: "Подтверждено", PAID: "Выплачено" };
const STATUS_DOT: Record<string, string> = { ACCRUED: "bg-amber-400", APPROVED: "bg-blue-500", PAID: "bg-emerald-500" };

export default async function CommissionsPage() {
  const session = await getAgentSession();
  const { commissions, payouts, accrued, approved, paid } = await getCommissions(session?.agentId ?? 0);

  return (
    <div className="p-7 max-w-[900px]">
      <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">Финансы</p>
      <h1 className="text-2xl font-bold text-slate-100 tracking-tight mb-8">Комиссии</h1>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <SumCard
          icon={<CurrencyDollar size={18} weight="duotone" className="text-emerald-400" />}
          label="К выплате"
          value={money(accrued + approved)}
          sub="начислено + подтверждено"
          accent="emerald"
        />
        <SumCard
          icon={<TrendUp size={18} weight="duotone" className="text-amber-400" />}
          label="Ожидает"
          value={money(accrued)}
          sub="ожидает подтверждения"
          accent="amber"
        />
        <SumCard
          icon={<CheckCircle size={18} weight="duotone" className="text-blue-400" />}
          label="Выплачено"
          value={money(paid)}
          sub="за всё время"
          accent="blue"
        />
      </div>

      {/* Commission history */}
      <div className="mb-7">
        <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-500 mb-3">История начислений</p>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
          {commissions.length === 0 ? (
            <div className="py-12 text-center">
              <CurrencyDollar size={32} className="text-slate-700 mx-auto mb-2" />
              <p className="text-[13px] text-slate-600">Начислений пока нет</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Заказ</th>
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Дата</th>
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Статус</th>
                  <th className="text-right text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3 text-[13px] font-medium text-slate-300 tabular-nums">#{c.orderId}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-500 tabular-nums">{formatDate(c.order?.createdAt)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.status] ?? "bg-slate-600"}`} />
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-[13.5px] font-semibold text-slate-200 tabular-nums">
                      {money(c.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Payouts */}
      {payouts.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-500 mb-3">Выплаты</p>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Выплата</th>
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Дата</th>
                  <th className="text-right text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-5 py-3 text-[13px] font-medium text-slate-300 tabular-nums">#{p.id}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-500 tabular-nums">{formatDate(p.paidAt)}</td>
                    <td className="px-5 py-3 text-right text-[13.5px] font-semibold text-emerald-400 tabular-nums">
                      {money(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SumCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent: "emerald" | "amber" | "blue" }) {
  const glow = { emerald: "shadow-[0_0_0_1px_rgba(16,185,129,0.1)]", amber: "shadow-[0_0_0_1px_rgba(245,158,11,0.1)]", blue: "shadow-[0_0_0_1px_rgba(59,130,246,0.1)]" }[accent];
  return (
    <div className={`bg-white/[0.035] border border-white/[0.07] rounded-xl p-5 ${glow}`}>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight text-slate-100 tabular-nums leading-none mb-2">{value}</div>
      <p className="text-[11px] text-slate-600">{sub}</p>
    </div>
  );
}
