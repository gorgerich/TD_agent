import type { ReactNode } from "react";
import { Warning } from "@phosphor-icons/react/dist/ssr";

// Единые состояния «пусто» и «ошибка» на токенах Quiet Depth (td-shell + icon-3d).
// Server-safe: без hooks и onClick — действие передаётся пропом `action`
// (<Button>/<Link>), чтобы компонент работал и в серверных, и в клиентских экранах.
// Состояние загрузки уже закрыто Skeletons.tsx (SkLine / ListPageSkeleton).

function StateShell({
  icon,
  title,
  description,
  action,
  tone = "accent",
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "accent" | "danger";
}) {
  return (
    <div className="td-shell px-6 py-14 text-center">
      {icon && (
        <span
          className={`mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full icon-3d ${
            tone === "danger" ? "text-danger" : "text-accent"
          }`}
        >
          {icon}
        </span>
      )}
      <h2 className="td-display text-[22px] text-ink">{title}</h2>
      {description && (
        <p className="mx-auto mt-2 max-w-[400px] text-[14px] leading-relaxed text-ink-2">{description}</p>
      )}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return <StateShell tone="accent" {...props} />;
}

export function ErrorState({
  icon,
  title = "Не удалось загрузить",
  description = "Проверьте соединение и повторите попытку.",
  action,
}: {
  icon?: ReactNode;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <StateShell
      tone="danger"
      icon={icon ?? <Warning size={24} weight="duotone" />}
      title={title}
      description={description}
      action={action}
    />
  );
}
