import CoView from "./CoView";

export default async function CoPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <div className="min-h-screen bg-[#060a12]">
      {/* Top bar */}
      <header className="border-b border-white/[0.05] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-white/90" />
          </div>
          <div>
            <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-slate-600 leading-none">Тихий дом</div>
            <div className="text-[12px] font-semibold text-slate-300 leading-none mt-0.5">Смета онлайн</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-blue-600/[0.1] border border-blue-600/20 rounded-full px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-[11px] font-semibold text-blue-300">Прямой эфир</span>
        </div>
      </header>

      <main className="px-6 py-10">
        <CoView code={code} />
      </main>
    </div>
  );
}
