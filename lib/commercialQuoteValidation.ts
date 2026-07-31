import { z } from "zod";

export const CommercialScenarioSchema = z.enum(["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"]);
export const CommercialValueStateSchema = z.enum(["KNOWN", "UNKNOWN", "REQUESTED", "EXPIRED"]);

export const CommercialLineSchema = z.object({
  stableKey: z.string().trim().min(1).max(160),
  position: z.number().int().nonnegative(),
  type: z.enum(["SERVICE", "PRODUCT", "PACKAGE", "ADD_ON", "EXTERNAL_EXPENSE", "MEMORIAL"]),
  catalogItemId: z.string().trim().max(200).nullable().optional(),
  catalogRevisionId: z.string().trim().max(200).nullable().optional(),
  serviceCode: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().max(10_000),
  unit: z.string().trim().min(1).max(50),
  priceState: CommercialValueStateSchema,
  clientUnitPrice: z.number().int().nonnegative().safe().nullable(),
  costState: CommercialValueStateSchema,
  unitCost: z.number().int().nonnegative().safe().nullable(),
  discountAmount: z.number().int().nonnegative().safe(),
  included: z.boolean(),
  optional: z.boolean(),
  relationKind: z.enum(["STANDALONE", "INCLUDED", "ADD_ON", "REPLACEMENT"]),
  relationKey: z.string().trim().max(160).nullable().optional(),
  source: z.string().trim().min(1).max(100),
  sourceVersion: z.string().trim().min(1).max(100),
  scenarioCompatibility: z.array(CommercialScenarioSchema).min(1).max(2),
}).superRefine((line, context) => {
  if ((line.priceState === "KNOWN") !== (line.clientUnitPrice !== null)) {
    context.addIssue({ code: "custom", message: "Состояние цены не соответствует значению", path: ["clientUnitPrice"] });
  }
  if ((line.costState === "KNOWN") !== (line.unitCost !== null)) {
    context.addIssue({ code: "custom", message: "Состояние себестоимости не соответствует значению", path: ["unitCost"] });
  }
  if (line.relationKind === "INCLUDED" || line.relationKind === "REPLACEMENT") {
    if (!line.relationKey) context.addIssue({ code: "custom", message: "Для связи нужна исходная позиция", path: ["relationKey"] });
  }
});

export const CommercialDraftSchema = z.object({
  scenario: CommercialScenarioSchema,
  lines: z.array(CommercialLineSchema).max(500),
  editorState: z.unknown().optional(),
});

export function commandMeta(req: Request) {
  return {
    idempotencyKey: req.headers.get("idempotency-key")?.trim() ?? "",
    correlationId: req.headers.get("x-correlation-id")?.trim() ?? "",
  };
}
