import type { Metadata } from "next";
import CoView from "./CoView";

export const metadata: Metadata = {
  title: "Смета — Тихий дом",
  description: "Опубликованный состав услуг и итоговая сумма.",
  robots: { index: false, follow: false },
};

export default async function CoPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // Тёплая бумага B2C tihiydom.com - клиент видит знакомый материал.
  return (
    <div className="min-h-[100dvh] bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 px-5 py-3.5 backdrop-blur-md sm:px-7">
        <span className="mx-auto flex w-full max-w-[700px] items-baseline justify-between gap-4">
          <span className="text-[15px] font-semibold text-ink">Тихий дом</span>
          <span className="td-eyebrow text-ink-3">Смета</span>
        </span>
      </header>

      <main className="px-5 py-7 sm:px-7 sm:py-10">
        <CoView code={code} />
      </main>
    </div>
  );
}
