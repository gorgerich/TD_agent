"use client";

import { useEffect } from "react";
import Link from "next/link";
import { WarningCircle, ArrowClockwise, House } from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";

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
          className={buttonClasses({ size: "lg" })}
        >
          <ArrowClockwise size={16} weight="bold" /> Попробовать снова
        </button>
        <Link
          href="/agent/cases"
          className={buttonClasses({ variant: "secondary", size: "lg" })}
        >
          <House size={16} /> На главную
        </Link>
      </div>
    </div>
  );
}
