import { z } from "zod";

export function validPaymentTerms(value: unknown): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  let nodes = 0;
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 100 || depth > 3) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item) && Number.isSafeInteger(item);
    if (typeof item === "string") return item.length <= 1000;
    if (Array.isArray(item)) return item.length <= 20 && item.every((entry) => visit(entry, depth + 1));
    if (typeof item !== "object" || item instanceof Date) return false;
    const entries = Object.entries(item);
    return entries.length <= 20 && entries.every(([key, entry]) => key.length > 0 && key.length <= 120
      && !["__proto__", "constructor", "prototype"].includes(key) && visit(entry, depth + 1));
  }
  return visit(value, 0) && Buffer.byteLength(JSON.stringify(value), "utf8") <= 4096;
}

export const PaymentTermsSchema = z.record(z.string().min(1).max(120), z.unknown())
  .refine(validPaymentTerms, "Условия оплаты превышают допустимую структуру или размер");
