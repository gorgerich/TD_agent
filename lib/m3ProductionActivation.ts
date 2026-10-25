import type { Prisma } from "@prisma/client";
import { getM3ProductionPolicyBinding, M3_CPO_AUDIT_ORGANIZATION_ID } from "@/lib/m3AuditMode";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import { commandFingerprint, prismaJson } from "@/lib/m3Command";
import {
  assertM3HumanSignoffsAuthorizeBundle, parseM3ApprovedPolicyBundle, parseM3HumanSignoffs,
  verifyActiveM3ProductionPolicyRows, type M3ApprovedPolicyBundle, type M3HumanSignoffs,
} from "@/lib/m3PolicyActivation";

const MAX_PROOF_BYTES = 512 * 1_024;
const transactionChecks = new WeakMap<Prisma.TransactionClient, Map<string, Promise<void>>>();

export async function persistM3ProductionPolicyProof(tx: Prisma.TransactionClient, bundle: M3ApprovedPolicyBundle, humanSignoffs: M3HumanSignoffs) {
  if (Buffer.byteLength(JSON.stringify({ bundle, humanSignoffs }), "utf8") > MAX_PROOF_BYTES) {
    throw new OperationalCommandError(422, "Пакет политик M3 превышает допустимый размер");
  }
  const bundleFingerprint = commandFingerprint(bundle);
  const existing = await tx.m3ProductionActivation.findUnique({
    where: { organizationId_bundleFingerprint: { organizationId: bundle.organizationId, bundleFingerprint } },
  });
  if (existing) {
    if (commandFingerprint(existing.bundle) !== bundleFingerprint || commandFingerprint(existing.humanSignoffs) !== commandFingerprint(humanSignoffs)) {
      throw new OperationalCommandError(409, "Подтверждение production-политик M3 не совпадает с исходным пакетом");
    }
    return;
  }
  await tx.m3ProductionActivation.create({ data: {
    organizationId: bundle.organizationId, activatedByUserId: bundle.approvedByUserId,
    bundleFingerprint, bundle: prismaJson(bundle), humanSignoffs: prismaJson(humanSignoffs),
  } });
}

export async function assertM3ProductionActivation(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") {
    if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "preview") {
      throw new OperationalCommandError(503, "Production-окружение M3 не определено. Изменения заблокированы");
    }
    return;
  }
  const binding = getM3ProductionPolicyBinding(organizationId);
  if (organizationId === M3_CPO_AUDIT_ORGANIZATION_ID && binding === null) return;
  if (!binding) throw new OperationalCommandError(403, "Реальная работа M3 для организации ещё не разрешена");
  let checks = transactionChecks.get(tx);
  if (!checks) { checks = new Map(); transactionChecks.set(tx, checks); }
  const key = `${organizationId}:${binding}`;
  let check = checks.get(key);
  if (!check) {
    check = verifyProof(tx, organizationId, binding);
    checks.set(key, check);
  }
  await check;
}

async function verifyProof(tx: Prisma.TransactionClient, organizationId: string, binding: string): Promise<void> {
  // Policy activation takes Organization before the shared reviewer locks too.
  const [proof] = await tx.$queryRaw<Array<{ id: string | null; activatedByUserId: number | null; bundle: Prisma.JsonValue; humanSignoffs: Prisma.JsonValue }>>`
    SELECT proof.id, proof."activatedByUserId", proof.bundle, proof."humanSignoffs"
    FROM "Organization" organization
    LEFT JOIN "M3ProductionActivation" proof ON proof."organizationId" = organization.id AND proof."bundleFingerprint" = ${binding}
    WHERE organization.id = ${organizationId} FOR SHARE OF organization
  `;
  const unavailable = () => new OperationalCommandError(503, "Подтверждённые production-политики M3 недоступны. Изменения заблокированы", "M3_PRODUCTION_POLICY_UNAVAILABLE");
  if (!proof?.id || Buffer.byteLength(JSON.stringify({ bundle: proof.bundle, humanSignoffs: proof.humanSignoffs }), "utf8") > MAX_PROOF_BYTES) throw unavailable();
  let bundle: M3ApprovedPolicyBundle;
  try {
    bundle = parseM3ApprovedPolicyBundle(proof.bundle);
    const humanSignoffs = parseM3HumanSignoffs(proof.humanSignoffs);
    assertM3HumanSignoffsAuthorizeBundle(bundle, humanSignoffs);
    if (bundle.organizationId !== organizationId || commandFingerprint(bundle) !== binding
      || proof.activatedByUserId !== bundle.approvedByUserId) throw unavailable();
  } catch {
    throw unavailable();
  }
  await verifyActiveM3ProductionPolicyRows(tx, bundle);
}

export async function assertConfiguredM3ProductionActivation(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  // Unenrolled organizations retain their existing M1/M2 case flow; M3 mutations
  // still require the strict check through their own capability/transaction boundary.
  if (getM3ProductionPolicyBinding(organizationId) !== null) await assertM3ProductionActivation(tx, organizationId);
}

export function runM3ProductionTransaction<T>(
  organizationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: Parameters<typeof runOperationalTransaction>[1] = {},
) {
  return runOperationalTransaction(async tx => {
    await assertM3ProductionActivation(tx, organizationId);
    return work(tx);
  }, options);
}

export async function verifyM3ProductionDocumentPreflight(organizationId: string): Promise<void> {
  if (process.env.VERCEL_ENV !== "production"
    || (organizationId === M3_CPO_AUDIT_ORGANIZATION_ID && getM3ProductionPolicyBinding(organizationId) === null)) return;
  await runM3ProductionTransaction(organizationId, async () => {});
}
