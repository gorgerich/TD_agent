"use client";

import { useEffect } from "react";
import Link from "next/link";
import { WarningCircle, ArrowClockwise, House } from "@phosphor-icons/react";

export default function AgentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Лог в консоль; продакшн-телеметрия подхватит digest.
    console.error("Agent route error:", error);
  }, [error]);

  return (
    <div className="td-page mx-auto flex min-h-[70dvh] max-w-[560px] flex-col items-center justify-center px-5 py-16 text-center">
      <span className="mb-5 grid h-16 w-16 place-items-center rounded-full bg-danger-soft text-danger">
        <WarningCircle size={30} weight="duotone" />
      </span>
      <span className="td-eyebrow">Сбой</span>
      <h1 className="mt-4 td-display text-[30px] leading-tight text-ink sm:text-[36px]">
        Что-то пошло не так
      </h1>
      <p className="mx-auto mt-2 max-w-[400px] text-[14px] leading-relaxed text-ink-2">
        Не удалось загрузить раздел. Это временно - повторите попытку. Если повторяется,
        вернитесь на главную.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-ink-3">код: {error.digest}</p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-on-accent shadow-[0_1px_2px_rgba(0,31,39,0.16),0_6px_14px_-12px_rgba(0,58,53,0.42)] transition-colors duration-150 hover:bg-accent-hover"
        >
          <ArrowClockwise size={16} weight="bold" /> Попробовать снова
        </button>
        <Link
          href="/agent/cases"
          className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 text-[14px] font-semibold text-ink shadow-[var(--hl-top)] transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
        >
          <House size={16} /> На главную
        </Link>
      </div>
    </div>
  );
}
