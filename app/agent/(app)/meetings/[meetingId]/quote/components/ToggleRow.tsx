"use client";

import { formatCurrency } from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function ToggleRow({
  label,
  price,
  checked,
  onChange,
  children,
}: {
  label: string;
  price?: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={s.toggleRow}>
      <div className={s.toggleRowMain}>
        <div className={s.toggleRowText}>
          <div className={s.toggleRowLabel}>{label}</div>
          {price !== undefined && price > 0 && (
            <div className={s.toggleRowPrice}>+{formatCurrency(price)}</div>
          )}
        </div>
        <label className={s.switch}>
          <input
            type="checkbox"
            className={s.switchInput}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className={s.switchTrack} />
        </label>
      </div>
      {checked && children && (
        <div className={s.toggleRowSub}>{children}</div>
      )}
    </div>
  );
}
