import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "./Button";

export type EmptyStateAction = {
  label: string;
  href: string;
};

export type EmptyStateProps = {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
};

export function EmptyState({
  icon,
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  className = "",
}: EmptyStateProps) {
  const hasActions = Boolean(primaryAction || secondaryAction);

  return (
    <section
      aria-label={title}
      className={[
        "rise td-shell px-6 py-14 text-center sm:px-10 sm:py-16",
        className,
      ].filter(Boolean).join(" ")}
    >
      <div className="mx-auto flex max-w-[560px] flex-col items-center">
        {icon && (
          <div className="mb-7 grid h-14 w-14 place-items-center rounded-[18px] bg-accent-soft text-accent shadow-[var(--shadow-xs),var(--hl-top)]">
            <span className="grid h-7 w-7 place-items-center [&>svg]:h-7 [&>svg]:w-7">
              {icon}
            </span>
          </div>
        )}

        {eyebrow && <p className="td-eyebrow text-ink-3">{eyebrow}</p>}

        <h2 className="td-display mt-2 text-[26px] leading-tight text-ink sm:text-[31px]">
          {title}
        </h2>

        {description && (
          <p className="mx-auto mt-3 max-w-[42ch] text-[14px] leading-relaxed text-ink-2">
            {description}
          </p>
        )}

        {hasActions && (
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {primaryAction && (
              <Link
                href={primaryAction.href}
                className={buttonClasses({ size: "md" })}
              >
                {primaryAction.label}
              </Link>
            )}

            {secondaryAction && (
              <Link
                href={secondaryAction.href}
                className={buttonClasses({ variant: "ghost", size: "md" })}
              >
                {secondaryAction.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/*
Usage examples:
<EmptyState title="Кейсов пока нет" description="Создайте первый кейс, чтобы вести встречи, сметы и документы в одном месте." primaryAction={{ label: "Новый кейс", href: "/agent/cases?new=1" }} />
<EmptyState eyebrow="Документы" title="Файлы ещё не загружены" description="Загрузите справки и договоры, когда они появятся по кейсу." />
<EmptyState title="Ничего не найдено" description="Измените запрос или сбросьте фильтры." secondaryAction={{ label: "Сбросить поиск", href: "/agent/cases" }} />
*/
