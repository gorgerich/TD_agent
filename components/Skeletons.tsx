// Скелеты загрузки (shimmer через .sk из globals). Server-safe, без состояния.

export function SkLine({ w = "100%", h = 14, className = "" }: { w?: string | number; h?: number; className?: string }) {
  return <span className={`sk block ${className}`} style={{ width: w, height: h }} />;
}

/** Скелет страницы-списка (заголовок + строки) — leads/meetings/commissions. */
export function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="td-page mx-auto max-w-[1160px] px-4 py-7 sm:px-7 sm:py-10">
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <SkLine w={60} h={11} />
          <SkLine w={200} h={36} className="mt-4" />
        </div>
        <SkLine w={140} h={48} className="!rounded-full" />
      </div>
      <div className="td-shell overflow-hidden">
        <div className="td-core overflow-hidden">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
              <SkLine w={180} h={16} />
              <SkLine w={120} h={13} className="ml-auto" />
              <SkLine w={70} h={13} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Скелет дашборда (hero + 3 статы + таблица). */
export function DashboardSkeleton() {
  return (
    <div className="td-page mx-auto max-w-[1240px] px-4 py-7 sm:px-7 sm:py-10">
      <div className="sk mb-7 h-[180px] !rounded-[22px]" />
      <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="sk h-[150px] !rounded-[22px]" />
        ))}
      </div>
      <SkLine w={160} h={14} className="mb-3" />
      <div className="sk h-[260px] !rounded-[22px]" />
    </div>
  );
}
