export default function OperationsLoading() {
  return (
    <div className="td-page mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-7 sm:py-8" aria-busy="true" aria-label="Загрузка командного обзора">
      <div className="h-5 w-28 animate-pulse rounded bg-surface-2" />
      <div className="mt-3 h-10 w-72 max-w-full animate-pulse rounded bg-surface-2" />
      <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] bg-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse bg-surface" />)}
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-surface" />
        <div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-surface" />
      </div>
      <span className="sr-only">Загружаем загрузку команды и риски по кейсам</span>
    </div>
  );
}
