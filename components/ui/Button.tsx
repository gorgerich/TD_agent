import * as React from "react";

// Премиум-кнопка (без shadcn): единые варианты/размеры на наших токенах.
// Используй <Button> для button-элементов и buttonClasses() для <Link>/<a>,
// чтобы один стиль работал на всей платформе с минимальным рефактором.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const BASE =
  "relative isolate inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-150 ease-out active:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-default disabled:opacity-45";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-on-accent)_18%,transparent)] hover:bg-accent-hover",
  secondary:
    "bg-surface text-ink shadow-[var(--hl-top)] ring-1 ring-inset ring-line hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger text-white hover:brightness-95",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-9 px-3.5 text-[12px]",
  md: "min-h-11 px-5 text-[13px]",
  lg: "min-h-12 px-6 text-[14px]",
};

export function buttonClasses(opts: { variant?: Variant; size?: Size; className?: string } = {}): string {
  const { variant = "primary", size = "md", className = "" } = opts;
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim();
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    />
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, leftIcon, rightIcon, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
