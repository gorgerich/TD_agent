import { notFound, redirect } from "next/navigation";
import { AuthenticationError, requireOperationalContext } from "@/lib/auth";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import { getCommercialPresentation } from "@/lib/commercialQuoteService";
import { formatMinorUnitsCurrency } from "@/lib/calculationUtils";
import { PresentationControls } from "./PresentationControls";

type PresentationState = {
  lines?: Array<{
    settlement: "COUNTED" | "INCLUDED" | "REPLACED";
    lineTotal: number | null;
    stableKey: string;
    description: string;
    quantity: number;
    unit: string;
    priceState: string;
    clientUnitPrice: number | null;
    included: boolean;
  }>;
  totals?: { total: number | null; totalState: string; blockers?: string[] };
};

// Exact minor-unit rendering: rounding each line and the total independently is how a
// presented composition stops adding up. See formatMinorUnitsCurrency.
const money = (minor: number) => formatMinorUnitsCurrency(minor);

export default async function PresentationPage({ params }: { params: Promise<{ presentationId: string }> }) {
  // Catch only "not authenticated" and "not found". A blanket catch turned a database
  // outage or a genuine conflict into a login bounce or a phantom deleted presentation —
  // an infrastructure failure presented to the agent as success, mid-meeting. Anything
  // else propagates to the error boundary, which reports honestly.
  const context = await requireOperationalContext().catch((error: unknown) => {
    if (error instanceof AuthenticationError) return null;
    throw error;
  });
  if (!context) redirect("/agent/login");
  const presentation = await getCommercialPresentation((await params).presentationId, context)
    .catch((error: unknown) => {
      if (error instanceof OperationalCommandError && error.status === 404) return null;
      throw error;
    });
  if (!presentation) notFound();
  const state = presentation.state as PresentationState;
  const lines = Array.isArray(state.lines) ? state.lines : [];

  return (
    <main className="min-h-screen bg-app px-4 py-5 text-ink sm:px-8 sm:py-8">
      <header className="mx-auto flex max-w-[1080px] items-start justify-between gap-5">
        <div>
          <p className="text-[13px] font-semibold text-accent">Режим презентации</p>
          <h1 className="td-display mt-1 text-[30px] leading-tight sm:text-[42px]">{presentation.clientName}</h1>
          <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-ink-2">
            Это отдельный показ сохранённого черновика. Завершение показа не публикует и не изменяет смету.
          </p>
        </div>
        <PresentationControls presentationId={presentation.id} quoteId={presentation.quoteId} />
      </header>

      <section className="mx-auto mt-8 max-w-[1080px] bg-surface px-5 py-5 sm:px-7 sm:py-7">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-[18px] font-semibold">Состав</h2>
          <strong className="text-[24px]">
            {state.totals?.totalState === "KNOWN" && state.totals.total !== null
              ? money(state.totals.total)
              : "Итог не подтверждён"}
          </strong>
        </div>
        <div className="mt-5 divide-y divide-line">
          {lines.map((line) => (
            <div key={line.stableKey} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="text-[14px] font-semibold">{line.description}</p>
                <p className="mt-1 text-[12px] text-ink-3">{line.quantity} {line.unit}{line.included ? " · включено" : ""}</p>
              </div>
              {/*
                Same rule as the client view: render the settled amount the server
                computed, so a replaced or included line never shows a price that the
                stated total does not contain.
              */}
              <p className="text-[14px] font-semibold">
                {line.settlement === "INCLUDED"
                  ? "В составе"
                  : line.settlement === "REPLACED"
                    ? "Заменено"
                    : line.lineTotal !== null
                      ? money(line.lineTotal)
                      : "Цена уточняется"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
