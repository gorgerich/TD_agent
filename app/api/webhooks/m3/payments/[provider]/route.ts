import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { processPaymentWebhook } from "@/lib/contractLedgerService";

export const runtime = "nodejs";

const Body = z.object({
  organizationId: z.string().min(1).max(120),
  caseId: z.string().min(1).max(120),
  obligationId: z.string().min(1).max(120),
  payerPartyId: z.string().min(1).max(120),
  externalEventId: z.string().min(1).max(160),
  eventVersion: z.string().min(1).max(40),
  externalTransactionId: z.string().min(1).max(160),
  amountKopecks: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("RUB"),
  occurredAt: z.string().datetime(),
  method: z.enum(["CASH", "SBP_QR", "CARD", "BANK_TRANSFER"]),
  evidenceReference: z.string().min(3).max(240),
});

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const provider = (await params).provider.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(provider)) return jsonError(404, "Provider не найден");
    const rawBody = await req.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonError(400, "Некорректный webhook payload");
    }
    const parsed = Body.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Некорректный webhook payload");
    const signature = req.headers.get("x-td-payment-signature") ?? "";
    const result = await processPaymentWebhook(provider, rawBody, signature, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, "m3/payment-webhook");
  }
}
