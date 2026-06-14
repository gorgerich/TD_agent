// Скелеты загрузки (shimmer через .sk из globals). Server-safe, без состояния.

export function SkLine({ w = "100%", h = 14, className = "" }: { w?: string | number; h?: number; className?: string }) {
  return <span className={`sk block ${className}`} style={{ width: w, height: h }} />;
}

/** Скелет страницы-списка (заголовок + строки-сущности) - кейсы/leads/meetings. */
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
      {/* Бакет-заголовок + строки-сущности (аватар + имя + действие), как в живом списке. */}
      <SkLine w={90} h={11} className="mb-2.5 ml-1" />
      <div className="td-shell overflow-hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3.5 border-b border-line px-5 py-3.5 last:border-0">
            <span className="sk h-9 w-9 flex-shrink-0 !rounded-full" />
            <span className="min-w-0 flex-1">
              <SkLine w={i % 2 ? 150 : 190} h={15} />
              <SkLine w={i % 2 ? 210 : 170} h={12} className="mt-1.5" />
            </span>
            <SkLine w={84} h={12} className="hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Скелет списка-сущностей без шапки страницы — для вложенных секций. */
export function EntityRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="td-shell overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 border-b border-line px-5 py-3.5 last:border-0">
          <span className="sk h-9 w-9 flex-shrink-0 !rounded-full" />
          <span className="min-w-0 flex-1">
            <SkLine w={i % 2 ? 150 : 190} h={15} />
            <SkLine w={i % 2 ? 210 : 170} h={12} className="mt-1.5" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Скелет страницы-формы (заголовок + поля + кнопка) - leads/new, meetings/new. */
export function FormPageSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="td-page mx-auto max-w-[640px] px-4 py-7 sm:px-7 sm:py-10">
      <div className="mb-7">
        <SkLine w={70} h={11} />
        <SkLine w={240} h={34} className="mt-4" />
      </div>
      <div className="td-shell overflow-hidden">
        <div className="td-core space-y-5 p-5 sm:p-7">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i}>
              <SkLine w={120} h={12} />
              <SkLine h={48} className="mt-2 !rounded-[16px]" />
            </div>
          ))}
          <SkLine h={52} className="!rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Скелет страницы-карточки (детали клиента/встречи). */
export function DetailPageSkeleton() {
  return (
    <div className="td-page mx-auto max-w-[820px] px-4 py-7 sm:px-7 sm:py-10">
      <SkLine w={140} h={13} className="mb-6" />
      <div className="td-shell overflow-hidden">
        <div className="td-core p-5 sm:p-7">
          <SkLine w={220} h={30} />
          <SkLine w={160} h={14} className="mt-3" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkLine key={i} h={64} className="!rounded-[16px]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Скелет дашборда (hero + 3 статы + таблица). */
export function DashboardSkeleton() {
  return (
    <div className="td-page mx-auto max-w-[1240px] px-4 py-7 sm:px-7 sm:py-10">
      <div className="sk mb-7 h-[180px] !rounded-[14px]" />
      <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="sk h-[150px] !rounded-[14px]" />
        ))}
      </div>
      <SkLine w={160} h={14} className="mb-3" />
      <div className="sk h-[260px] !rounded-[14px]" />
    </div>
  );
}
