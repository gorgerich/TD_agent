import { createHash, createPublicKey } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { commandFingerprint } from "@/lib/m3Command";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import { appendPlatformAudit } from "@/lib/platformAudit";

const FINGERPRINT = z.string().regex(/^[0-9a-f]{64}$/);
const PUBLIC_KEY_PEM = z.string().min(80).max(2_000).refine(
  (value) => value === value.trim()
    && value.startsWith("-----BEGIN PUBLIC KEY-----")
    && value.endsWith("-----END PUBLIC KEY-----"),
  "Reviewer public key must be a canonical PEM-encoded public key",
);
const CANONICAL_NAME = z.string().min(3).max(160).refine(
  (value) => value === value.trim(),
  "Reviewer name must not contain leading or trailing whitespace",
);
const ISO_INSTANT = z.iso.datetime();

export const M3_REVIEWER_ROLES = [
  "FINANCE_ACCOUNTING",
  "LEGAL_PRIVACY",
  "RITUAL_OPERATIONS_SME",
] as const;

export const M3ReviewerCredentialRegistrationInput = z.object({
  schemaVersion: z.literal(1),
  reviewerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/),
  reviewerName: CANONICAL_NAME,
  reviewerRole: z.enum(M3_REVIEWER_ROLES),
  publicKeyPem: PUBLIC_KEY_PEM,
  verificationMethod: z.enum(["IN_PERSON", "VIDEO_CALL", "CORPORATE_CHANNEL", "SIGNED_DOCUMENT"]),
  verificationReference: z.string().min(3).max(500).refine(
    (value) => value === value.trim(),
    "Verification reference must not contain leading or trailing whitespace",
  ),
  verifiedAt: ISO_INSTANT,
}).strict();

export const M3ReviewerCredentialRegistrationMetadata = z.object({
  schemaVersion: z.literal(2),
  reviewerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/),
  reviewerNameFingerprint: FINGERPRINT,
  reviewerRole: z.enum(M3_REVIEWER_ROLES),
  credentialReferenceFingerprint: FINGERPRINT,
  keyFingerprint: FINGERPRINT,
  publicKeyPem: PUBLIC_KEY_PEM,
  verificationMethod: z.enum(["IN_PERSON", "VIDEO_CALL", "CORPORATE_CHANNEL", "SIGNED_DOCUMENT"]),
  verificationReferenceFingerprint: FINGERPRINT,
  verifiedAt: ISO_INSTANT,
  actorUserId: z.number().int().positive(),
  actorPlatformRoleAtEvent: z.literal("SUPER_ADMIN"),
}).strict();

export const M3ReviewerCredentialRevocationMetadata = z.object({
  schemaVersion: z.literal(2),
  keyFingerprint: FINGERPRINT,
  reasonCode: z.enum(["CREDENTIAL_COMPROMISED", "REVIEWER_OFFBOARDED", "ROTATED", "OTHER_APPROVED"]),
  actorUserId: z.number().int().positive(),
  actorPlatformRoleAtEvent: z.literal("SUPER_ADMIN"),
  revokedAt: ISO_INSTANT,
}).strict();

export type M3ReviewerCredentialRegistration = z.infer<typeof M3ReviewerCredentialRegistrationInput>;
export type M3ReviewerRole = (typeof M3_REVIEWER_ROLES)[number];

type AuditTx = Prisma.TransactionClient;

export function m3ReviewerPublicKeyFingerprint(publicKeyPem: string) {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("M3 reviewer credential must be an Ed25519 public key");
  }
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

export async function registerM3ReviewerCredential(
  tx: AuditTx,
  actorUserId: number,
  rawInput: unknown,
  now = new Date(),
) {
  const input = M3ReviewerCredentialRegistrationInput.parse(rawInput);
  if (new Date(input.verifiedAt).getTime() > now.getTime()) {
    throw new OperationalCommandError(400, "M3 reviewer identity verification cannot be future-dated");
  }
  const keyFingerprint = m3ReviewerPublicKeyFingerprint(input.publicKeyPem);
  await lockCredential(tx, keyFingerprint);
  await requireSuperAdminAtEvent(tx, actorUserId);

  const metadata = M3ReviewerCredentialRegistrationMetadata.parse({
    schemaVersion: 2,
    reviewerId: input.reviewerId,
    reviewerNameFingerprint: commandFingerprint(input.reviewerName),
    reviewerRole: input.reviewerRole,
    credentialReferenceFingerprint: commandFingerprint(`platform-audit-key:${keyFingerprint}`),
    keyFingerprint,
    publicKeyPem: input.publicKeyPem,
    verificationMethod: input.verificationMethod,
    verificationReferenceFingerprint: commandFingerprint(input.verificationReference),
    verifiedAt: input.verifiedAt,
    actorUserId,
    actorPlatformRoleAtEvent: "SUPER_ADMIN",
  });
  const latest = await latestCredentialEvent(tx, keyFingerprint);
  if (latest?.action === "M3_REVIEWER_CREDENTIAL_REVOKED") {
    throw new OperationalCommandError(409, "Revoked M3 reviewer credentials cannot be reactivated; register a new key");
  }
  if (latest?.action === "M3_REVIEWER_CREDENTIAL_REGISTERED") {
    const existing = M3ReviewerCredentialRegistrationMetadata.safeParse(latest.metadata);
    if (!existing.success || commandFingerprint(existing.data) !== commandFingerprint(metadata)) {
      throw new OperationalCommandError(409, "M3 reviewer key is already registered to different verified identity metadata");
    }
    return { replayed: true, keyFingerprint, auditEventId: latest.id, registeredAt: latest.createdAt };
  }

  const event = await appendPlatformAudit(tx, {
    actorUserId,
    action: "M3_REVIEWER_CREDENTIAL_REGISTERED",
    targetType: "m3-reviewer-credential",
    targetId: keyFingerprint,
    metadata,
    createdAt: now,
  });
  return { replayed: false, keyFingerprint, auditEventId: event.id, registeredAt: event.createdAt };
}

export async function revokeM3ReviewerCredential(
  tx: AuditTx,
  actorUserId: number,
  keyFingerprint: string,
  reasonCode: z.infer<typeof M3ReviewerCredentialRevocationMetadata>["reasonCode"],
  now = new Date(),
) {
  FINGERPRINT.parse(keyFingerprint);
  await lockCredential(tx, keyFingerprint);
  await requireSuperAdminAtEvent(tx, actorUserId);
  const latest = await latestCredentialEvent(tx, keyFingerprint);
  if (!latest) throw new OperationalCommandError(404, "M3 reviewer credential is not registered");
  if (latest.action === "M3_REVIEWER_CREDENTIAL_REVOKED") {
    return { replayed: true, keyFingerprint, auditEventId: latest.id, revokedAt: latest.createdAt };
  }
  if (!M3ReviewerCredentialRegistrationMetadata.safeParse(latest.metadata).success) {
    throw new OperationalCommandError(409, "M3 reviewer credential registry metadata is invalid");
  }
  const revokedAt = new Date(Math.max(now.getTime(), latest.createdAt.getTime() + 1));
  const event = await appendPlatformAudit(tx, {
    actorUserId,
    action: "M3_REVIEWER_CREDENTIAL_REVOKED",
    targetType: "m3-reviewer-credential",
    targetId: keyFingerprint,
    metadata: M3ReviewerCredentialRevocationMetadata.parse({
      schemaVersion: 2,
      keyFingerprint,
      reasonCode,
      actorUserId,
      actorPlatformRoleAtEvent: "SUPER_ADMIN",
      revokedAt: revokedAt.toISOString(),
    }),
    createdAt: revokedAt,
  });
  return { replayed: false, keyFingerprint, auditEventId: event.id, revokedAt: event.createdAt };
}

export async function requireActiveM3ReviewerCredential(
  tx: AuditTx,
  expected: {
    reviewerId: string;
    reviewerName: string;
    reviewerRole: M3ReviewerRole;
    publicKeyPem: string;
    keyFingerprint: string;
  },
) {
  const latest = await latestCredentialEvent(tx, expected.keyFingerprint);
  if (!latest || latest.action !== "M3_REVIEWER_CREDENTIAL_REGISTERED") {
    throw new OperationalCommandError(403, "M3 reviewer credential is not actively registered");
  }
  const metadata = M3ReviewerCredentialRegistrationMetadata.safeParse(latest.metadata);
  if (!metadata.success || latest.actorUserId !== metadata.data.actorUserId) {
    throw new OperationalCommandError(403, "M3 reviewer credential registry metadata is invalid");
  }
  const actual = metadata.data;
  if (
    actual.actorPlatformRoleAtEvent !== "SUPER_ADMIN"
    || actual.reviewerId !== expected.reviewerId
    || actual.reviewerNameFingerprint !== commandFingerprint(expected.reviewerName)
    || actual.reviewerRole !== expected.reviewerRole
    || actual.keyFingerprint !== expected.keyFingerprint
    || actual.credentialReferenceFingerprint !== commandFingerprint(`platform-audit-key:${expected.keyFingerprint}`)
    || actual.publicKeyPem !== expected.publicKeyPem
    || m3ReviewerPublicKeyFingerprint(actual.publicKeyPem) !== expected.keyFingerprint
  ) {
    throw new OperationalCommandError(403, "M3 reviewer credential does not match registered identity");
  }
  return { auditEventId: latest.id, registeredAt: latest.createdAt, metadata: actual };
}

async function requireSuperAdminAtEvent(tx: AuditTx, actorUserId: number) {
  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { platformRole: true },
  });
  if (actor?.platformRole !== "SUPER_ADMIN") {
    throw new OperationalCommandError(403, "Active Platform SUPER_ADMIN is required for M3 reviewer credential changes");
  }
}

async function lockCredential(tx: AuditTx, keyFingerprint: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`m3-reviewer-credential:${keyFingerprint}`}, 0))
  `;
}

async function latestCredentialEvent(tx: AuditTx, keyFingerprint: string) {
  const events = await tx.platformAuditEvent.findMany({
    where: {
      targetType: "m3-reviewer-credential",
      targetId: keyFingerprint,
      action: { in: ["M3_REVIEWER_CREDENTIAL_REGISTERED", "M3_REVIEWER_CREDENTIAL_REVOKED"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 2,
    select: { id: true, action: true, metadata: true, actorUserId: true, createdAt: true },
  });
  if (events.length > 1 && events[0]!.createdAt.getTime() === events[1]!.createdAt.getTime()) {
    throw new OperationalCommandError(409, "M3 reviewer credential registry has ambiguous same-time events");
  }
  return events[0] ?? null;
}
