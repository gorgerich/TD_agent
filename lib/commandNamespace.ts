import { createHash } from "node:crypto";
import { OperationalCommandError } from "@/lib/operationalTransaction";

export function assertClientCommandKey(key: string): void {
  if (/^(server:|projection:|quote:|quote-decision:|catalog:|invite:accepted:|finance-mfa-enabled:|webhook:|webhook-audit:|document-access:|document-rejection:|document-review-escalation:)/.test(key)) {
    throw new OperationalCommandError(400, "Этот namespace зарезервирован для серверных команд");
  }
}

export function serverCommandKey(kind: string, parent: string): string {
  return `server:${kind}:${createHash("sha256").update(parent).digest("hex")}`;
}
