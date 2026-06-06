import CoView from "./CoView";

export default async function CoPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <div className="min-h-[100dvh] bg-[#F7F5F0]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface/90 px-5 py-3.5 backdrop-blur-md sm:px-7">
        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[9px] bg-accent text-on-accent">
          <span className="block h-2 w-2 rounded-full bg-on-accent" />
        </span>
        <span className="leading-tight">
          <span className="block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-3">Тихий дом</span>
          <span className="block text-[13px] font-semibold text-ink">Смета онлайн</span>
        </span>
      </header>

      <main className="px-5 py-7 sm:px-7 sm:py-10">
        <CoView code={code} />
      </main>
    </div>
  );
}
