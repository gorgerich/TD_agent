import * as React from "react";

// Премиум-бейдж/пилюля на токенах. Тон = семантика; dot = статус-индикатор.
type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, { wrap: string; dot: string }> = {
  neutral: { wrap: "border-line bg-surface text-ink-2", dot: "bg-ink-3" },
  accent: { wrap: "border-accent/15 bg-accent-soft text-accent", dot: "bg-accent" },
  success: { wrap: "border-success/20 bg-success-soft text-success", dot: "bg-success" },
  warning: { wrap: "border-warning/20 bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { wrap: "border-danger/20 bg-danger-soft text-danger", dot: "bg-danger" },
  info: { wrap: "border-info/20 bg-info-soft text-info", dot: "bg-info" },
};

export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span className={`tnum inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-none shadow-[var(--hl-top)] ${t.wrap} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

export default Badge;
