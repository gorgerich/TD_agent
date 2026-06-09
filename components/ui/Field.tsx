import * as React from "react";

// Премиум поле ввода (label + иконка + фокус-кольцо + мягкая глубина + ошибка).
// На наших токенах, без внешних зависимостей. Паттерн - 21st/Ark, наша стилистика.

const inputBase =
  "min-h-12 w-full rounded-[12px] border border-line bg-surface text-[14px] text-ink outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-ink-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_1px_2px_rgba(0,31,39,0.04)] focus:border-accent focus:bg-surface focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_0_0_3px_rgba(0,58,53,0.14),0_8px_18px_-16px_rgba(0,31,39,0.32)] disabled:opacity-50";

export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  error?: string | null;
  hint?: string;
}

export const Field = React.forwardRef<HTMLInputElement, FieldProps>(function Field(
  { id, label, icon, trailing, error, hint, className, required, ...rest },
  ref,
) {
  return (
    <div className="min-w-0">
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-ink-2">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">{icon}</span>
        )}
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${inputBase} ${icon ? "pl-11" : "px-3.5"} ${trailing ? "pr-12" : icon ? "pr-4" : ""} ${error ? "border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(176,68,58,0.14)]" : ""} ${className ?? ""}`}
          {...rest}
        />
        {trailing && <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[12px] text-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
});

export default Field;
