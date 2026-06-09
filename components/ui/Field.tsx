import * as React from "react";

// Премиум поле ввода (label + иконка + фокус-кольцо + мягкая глубина + ошибка).
// На наших токенах, без внешних зависимостей. Паттерн — 21st/Ark, наша стилистика.

const inputBase =
  "min-h-12 w-full rounded-[12px] border border-line bg-surface text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_1px_2px_rgba(40,30,18,0.04)] focus:border-accent focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_3px_rgba(37,99,235,0.14)] disabled:opacity-50";

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
    <div>
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
          className={`${inputBase} ${icon ? "pl-11" : "px-3.5"} ${trailing ? "pr-12" : icon ? "pr-4" : ""} ${error ? "border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(176,68,58,0.14)]" : ""} ${className ?? ""}`}
          {...rest}
        />
        {trailing && <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
});

export default Field;
