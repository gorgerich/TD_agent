import { OperationalCommandError } from "@/lib/operationalTransaction";

export function assertConfiguredPaymentProvider(provider: string): void {
  const configured = process.env.M3_PAYMENT_WEBHOOK_PROVIDER;
  if (!configured || !/^[a-z0-9-]{2,40}$/.test(configured)) {
    throw new OperationalCommandError(503, "Платёжный provider временно не настроен");
  }
  if (provider !== configured) throw new OperationalCommandError(404, "Provider не найден");
  if ((process.env.M3_PAYMENT_WEBHOOK_SECRET?.trim().length ?? 0) < 32) {
    throw new OperationalCommandError(503, "Платёжный provider временно недоступен");
  }
}
