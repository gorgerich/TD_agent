import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { commandFingerprint } from "@/lib/m3Command";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import { appendPlatformAudit } from "@/lib/platformAudit";

const FINGERPRINT = z.string().regex(/^[0-9a-f]{64}$/);
const AUDIT_EVENT_ID = z.string().min(8).max(128);
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
const AUTHORITY_GRANT_TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const AUTHORITY_GRANT_TTL_MS = 15 * 60 * 1_000;

export const M3_REVIEWER_ROLES = [
  "FINANCE_ACCOUNTING",
  "LEGAL_PRIVACY",
  "RITUAL_OPERATIONS_SME",
] as const;

const M3_REVIEWER_CREDENTIAL_OPERATIONS = ["REGISTER", "REVOKE"] as const;

export const M3ReviewerAuthorityGrantInput = z.object({
  operation: z.enum(M3_REVIEWER_CREDENTIAL_OPERATIONS),
  keyFingerprint: FINGERPRINT,
}).strict();

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

export const M3ReviewerAuthorityGrantMetadata = z.object({
  schemaVersion: z.literal(1),
  operation: z.enum(M3_REVIEWER_CREDENTIAL_OPERATIONS),
  keyFingerprint: FINGERPRINT,
  actorUserId: z.number().int().positive(),
  actorPlatformRoleAtEvent: z.literal("SUPER_ADMIN"),
  authoritySessionVersion: z.number().int().nonnegative(),
  authorityMfaVerified: z.literal(true),
  issuedAt: ISO_INSTANT,
  expiresAt: ISO_INSTANT,
}).strict();

export const M3ReviewerAuthorityGrantConsumptionMetadata = z.object({
  schemaVersion: z.literal(1),
  operation: z.enum(M3_REVIEWER_CREDENTIAL_OPERATIONS),
  keyFingerprint: FINGERPRINT,
  grantAuditEventId: AUDIT_EVENT_ID,
  resultAuditEventId: AUDIT_EVENT_ID,
  outcome: z.enum(["APPLIED", "REPLAYED"]),
  consumedAt: ISO_INSTANT,
}).strict();

export const M3ReviewerCredentialRegistrationMetadata = z.object({
  schemaVersion: z.literal(4),
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
  authorityProofType: z.literal("ONE_TIME_PLATFORM_AUTHORITY_GRANT"),
  authoritySessionVersion: z.number().int().nonnegative(),
  authorityGrantAuditEventId: AUDIT_EVENT_ID,
  authorityGrantFingerprint: FINGERPRINT,
  authorityGrantIssuedAt: ISO_INSTANT,
}).strict();

export const M3ReviewerCredentialRevocationMetadata = z.object({
  schemaVersion: z.literal(4),
  keyFingerprint: FINGERPRINT,
  reasonCode: z.enum(["CREDENTIAL_COMPROMISED", "REVIEWER_OFFBOARDED", "ROTATED", "OTHER_APPROVED"]),
  actorUserId: z.number().int().positive(),
  actorPlatformRoleAtEvent: z.literal("SUPER_ADMIN"),
  authorityProofType: z.literal("ONE_TIME_PLATFORM_AUTHORITY_GRANT"),
  authoritySessionVersion: z.number().int().nonnegative(),
  authorityGrantAuditEventId: AUDIT_EVENT_ID,
  authorityGrantFingerprint: FINGERPRINT,
  authorityGrantIssuedAt: ISO_INSTANT,
  revokedAt: ISO_INSTANT,
}).strict();

export type M3ReviewerCredentialRegistration = z.infer<typeof M3ReviewerCredentialRegistrationInput>;
export type M3ReviewerRole = (typeof M3_REVIEWER_ROLES)[number];
export type M3ReviewerAuthorityGrantRequest = z.infer<typeof M3ReviewerAuthorityGrantInput>;

type AuditTx = Prisma.TransactionClient;
type ReviewerCredentialAuthority = {
  actorUserId: number;
  sessionVersion: number;
  operation: (typeof M3_REVIEWER_CREDENTIAL_OPERATIONS)[number];
  keyFingerprint: string;
  grantAuditEventId: string;
  grantFingerprint: string;
  grantIssuedAt: Date;
  now: Date;
  consumed: z.infer<typeof M3ReviewerAuthorityGrantConsumptionMetadata> | null;
};

type ReviewerAuthorityContext = {
  userId: number;
  platformRole: "SUPER_ADMIN";
  sessionVersion: number;
  platformMfaEnabled: boolean;
  mfaVerified: boolean;
};

export function m3ReviewerPublicKeyFingerprint(publicKeyPem: string) {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("M3 reviewer credential must be an Ed25519 public key");
  }
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

/**
 * Called by the authenticated Platform Admin route. The raw grant leaves that
 * route once; PostgreSQL stores only its SHA-256 fingerprint.
 */
export async function issueM3ReviewerAuthorityGrant(
  tx: AuditTx,
  context: ReviewerAuthorityContext,
  rawInput: unknown,
) {
  const input = M3ReviewerAuthorityGrantInput.parse(rawInput);
  await requireGrantIssuerAtEvent(tx, context);
  const now = await databaseNow(tx);
  const expiresAt = new Date(now.getTime() + AUTHORITY_GRANT_TTL_MS);
  const token = randomBytes(32).toString("base64url");
  const grantFingerprint = authorityGrantFingerprint(token);
  const event = await appendPlatformAudit(tx, {
    actorUserId: context.userId,
    action: "M3_REVIEWER_AUTHORITY_GRANTED",
    targetType: "m3-reviewer-authority",
    targetId: grantFingerprint,
    metadata: M3ReviewerAuthorityGrantMetadata.parse({
      schemaVersion: 1,
      operation: input.operation,
      keyFingerprint: input.keyFingerprint,
      actorUserId: context.userId,
      actorPlatformRoleAtEvent: "SUPER_ADMIN",
      authoritySessionVersion: context.sessionVersion,
      authorityMfaVerified: true,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
    createdAt: now,
  });
  return { token, expiresAt, auditEventId: event.id };
}

export async function registerM3ReviewerCredential(
  tx: AuditTx,
  authorityGrantToken: string,
  rawInput: unknown,
) {
  const input = M3ReviewerCredentialRegistrationInput.parse(rawInput);
  const keyFingerprint = m3ReviewerPublicKeyFingerprint(input.publicKeyPem);
  const authority = await resolveReviewerCredentialAuthority(tx, authorityGrantToken, "REGISTER", keyFingerprint);
  if (new Date(input.verifiedAt).getTime() > authority.now.getTime()) {
    throw new OperationalCommandError(400, "M3 reviewer identity verification cannot be future-dated");
  }
  await lockCredential(tx, keyFingerprint);

  const metadata = M3ReviewerCredentialRegistrationMetadata.parse({
    schemaVersion: 4,
    reviewerId: input.reviewerId,
    reviewerNameFingerprint: commandFingerprint(input.reviewerName),
    reviewerRole: input.reviewerRole,
    credentialReferenceFingerprint: commandFingerprint(`platform-audit-key:${keyFingerprint}`),
    keyFingerprint,
    publicKeyPem: input.publicKeyPem,
    verificationMethod: input.verificationMethod,
    verificationReferenceFingerprint: commandFingerprint(input.verificationReference),
    verifiedAt: input.verifiedAt,
    actorUserId: authority.actorUserId,
    actorPlatformRoleAtEvent: "SUPER_ADMIN",
    authorityProofType: "ONE_TIME_PLATFORM_AUTHORITY_GRANT",
    authoritySessionVersion: authority.sessionVersion,
    authorityGrantAuditEventId: authority.grantAuditEventId,
    authorityGrantFingerprint: authority.grantFingerprint,
    authorityGrantIssuedAt: authority.grantIssuedAt.toISOString(),
  });
  const latest = await latestCredentialEvent(tx, keyFingerprint);
  if (authority.consumed) {
    return replayConsumedRegistration(authority.consumed, latest, metadata, keyFingerprint);
  }
  if (latest?.action === "M3_REVIEWER_CREDENTIAL_REVOKED") {
    throw new OperationalCommandError(409, "Revoked M3 reviewer credentials cannot be reactivated; register a new key");
  }
  if (latest?.action === "M3_REVIEWER_CREDENTIAL_REGISTERED") {
    const existing = M3ReviewerCredentialRegistrationMetadata.safeParse(latest.metadata);
    if (!existing.success || registrationIdentityFingerprint(existing.data) !== registrationIdentityFingerprint(metadata)) {
      throw new OperationalCommandError(409, "M3 reviewer key is already registered to different verified identity metadata");
    }
    await consumeAuthorityGrant(tx, authority, latest.id, "REPLAYED");
    return { replayed: true, keyFingerprint, auditEventId: latest.id, registeredAt: latest.createdAt };
  }

  const event = await appendPlatformAudit(tx, {
    actorUserId: authority.actorUserId,
    action: "M3_REVIEWER_CREDENTIAL_REGISTERED",
    targetType: "m3-reviewer-credential",
    targetId: keyFingerprint,
    metadata,
    createdAt: authority.now,
  });
  await consumeAuthorityGrant(tx, authority, event.id, "APPLIED");
  return { replayed: false, keyFingerprint, auditEventId: event.id, registeredAt: event.createdAt };
}

export async function revokeM3ReviewerCredential(
  tx: AuditTx,
  authorityGrantToken: string,
  keyFingerprint: string,
  reasonCode: z.infer<typeof M3ReviewerCredentialRevocationMetadata>["reasonCode"],
) {
  FINGERPRINT.parse(keyFingerprint);
  const authority = await resolveReviewerCredentialAuthority(tx, authorityGrantToken, "REVOKE", keyFingerprint);
  await lockCredential(tx, keyFingerprint);
  const latest = await latestCredentialEvent(tx, keyFingerprint);
  if (authority.consumed) {
    const existing = latest?.action === "M3_REVIEWER_CREDENTIAL_REVOKED"
      ? M3ReviewerCredentialRevocationMetadata.safeParse(latest.metadata)
      : null;
    if (
      !existing?.success
      || existing.data.reasonCode !== reasonCode
      || authority.consumed.resultAuditEventId !== latest?.id
    ) {
      throw new OperationalCommandError(409, "M3 reviewer authority grant was already consumed by another result");
    }
    return { replayed: true, keyFingerprint, auditEventId: latest.id, revokedAt: latest.createdAt };
  }
  if (!latest) throw new OperationalCommandError(404, "M3 reviewer credential is not registered");
  if (latest.action === "M3_REVIEWER_CREDENTIAL_REVOKED") {
    const existing = M3ReviewerCredentialRevocationMetadata.safeParse(latest.metadata);
    if (!existing.success || existing.data.reasonCode !== reasonCode) {
      throw new OperationalCommandError(409, "M3 reviewer credential is already revoked with a different reason");
    }
    await consumeAuthorityGrant(tx, authority, latest.id, "REPLAYED");
    return { replayed: true, keyFingerprint, auditEventId: latest.id, revokedAt: latest.createdAt };
  }
  if (!M3ReviewerCredentialRegistrationMetadata.safeParse(latest.metadata).success) {
    throw new OperationalCommandError(409, "M3 reviewer credential registry metadata is invalid");
  }
  const revokedAt = new Date(Math.max(authority.now.getTime(), latest.createdAt.getTime() + 1));
  const event = await appendPlatformAudit(tx, {
    actorUserId: authority.actorUserId,
    action: "M3_REVIEWER_CREDENTIAL_REVOKED",
    targetType: "m3-reviewer-credential",
    targetId: keyFingerprint,
    metadata: M3ReviewerCredentialRevocationMetadata.parse({
      schemaVersion: 4,
      keyFingerprint,
      reasonCode,
      actorUserId: authority.actorUserId,
      actorPlatformRoleAtEvent: "SUPER_ADMIN",
      authorityProofType: "ONE_TIME_PLATFORM_AUTHORITY_GRANT",
      authoritySessionVersion: authority.sessionVersion,
      authorityGrantAuditEventId: authority.grantAuditEventId,
      authorityGrantFingerprint: authority.grantFingerprint,
      authorityGrantIssuedAt: authority.grantIssuedAt.toISOString(),
      revokedAt: revokedAt.toISOString(),
    }),
    createdAt: revokedAt,
  });
  await consumeAuthorityGrant(tx, authority, event.id, "APPLIED");
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
  await lockCredential(tx, expected.keyFingerprint);
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

async function resolveReviewerCredentialAuthority(
  tx: AuditTx,
  rawToken: string,
  operation: (typeof M3_REVIEWER_CREDENTIAL_OPERATIONS)[number],
  keyFingerprint: string,
): Promise<ReviewerCredentialAuthority> {
  if (!rawToken || rawToken !== rawToken.trim() || !AUTHORITY_GRANT_TOKEN.safeParse(rawToken).success) {
    throw new OperationalCommandError(403, "Valid one-time Platform SUPER_ADMIN authority grant is required");
  }
  const grantFingerprint = authorityGrantFingerprint(rawToken);
  await lockAuthorityGrant(tx, grantFingerprint);
  const events = await tx.platformAuditEvent.findMany({
    where: {
      targetType: "m3-reviewer-authority",
      targetId: grantFingerprint,
      action: { in: ["M3_REVIEWER_AUTHORITY_GRANTED", "M3_REVIEWER_AUTHORITY_CONSUMED"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, action: true, metadata: true, actorUserId: true, createdAt: true },
  });
  const grants = events.filter((event) => event.action === "M3_REVIEWER_AUTHORITY_GRANTED");
  const consumptions = events.filter((event) => event.action === "M3_REVIEWER_AUTHORITY_CONSUMED");
  if (grants.length !== 1 || consumptions.length > 1) {
    throw new OperationalCommandError(403, "M3 reviewer authority grant is missing or ambiguous");
  }
  const event = grants[0]!;
  const metadata = M3ReviewerAuthorityGrantMetadata.safeParse(event.metadata);
  const now = await databaseNow(tx);
  if (
    !metadata.success
    || event.actorUserId !== metadata.data.actorUserId
    || metadata.data.operation !== operation
    || metadata.data.keyFingerprint !== keyFingerprint
    || metadata.data.actorPlatformRoleAtEvent !== "SUPER_ADMIN"
    || metadata.data.authorityMfaVerified !== true
    || new Date(metadata.data.issuedAt).getTime() !== event.createdAt.getTime()
    || now.getTime() >= new Date(metadata.data.expiresAt).getTime()
  ) {
    throw new OperationalCommandError(403, "M3 reviewer authority grant is invalid or expired");
  }
  const actor = await tx.user.findUnique({
    where: { id: metadata.data.actorUserId },
    select: { platformRole: true, platformMfaEnabledAt: true, sessionVersion: true },
  });
  if (
    actor?.platformRole !== "SUPER_ADMIN"
    || actor.platformMfaEnabledAt == null
    || actor.sessionVersion !== metadata.data.authoritySessionVersion
  ) {
    throw new OperationalCommandError(403, "Current MFA-verified Platform SUPER_ADMIN authority is required for M3 reviewer credential changes");
  }
  const consumed = consumptions[0]
    ? M3ReviewerAuthorityGrantConsumptionMetadata.safeParse(consumptions[0].metadata)
    : null;
  if (consumed && (
    !consumed.success
    || consumptions[0]!.actorUserId !== metadata.data.actorUserId
    || consumed.data.grantAuditEventId !== event.id
    || consumed.data.operation !== operation
    || consumed.data.keyFingerprint !== keyFingerprint
  )) {
    throw new OperationalCommandError(409, "M3 reviewer authority grant consumption record is invalid");
  }
  return {
    actorUserId: metadata.data.actorUserId,
    sessionVersion: metadata.data.authoritySessionVersion,
    operation,
    keyFingerprint,
    grantAuditEventId: event.id,
    grantFingerprint,
    grantIssuedAt: event.createdAt,
    now,
    consumed: consumed?.success ? consumed.data : null,
  };
}

async function requireGrantIssuerAtEvent(tx: AuditTx, context: ReviewerAuthorityContext) {
  if (
    context.platformRole !== "SUPER_ADMIN"
    || context.platformMfaEnabled !== true
    || context.mfaVerified !== true
  ) {
    throw new OperationalCommandError(403, "Fresh MFA-verified Platform SUPER_ADMIN session is required");
  }
  const actor = await tx.user.findUnique({
    where: { id: context.userId },
    select: { platformRole: true, platformMfaEnabledAt: true, sessionVersion: true },
  });
  if (
    actor?.platformRole !== "SUPER_ADMIN"
    || actor.platformMfaEnabledAt == null
    || actor.sessionVersion !== context.sessionVersion
  ) {
    throw new OperationalCommandError(403, "Current MFA-verified Platform SUPER_ADMIN authority is required");
  }
}

async function consumeAuthorityGrant(
  tx: AuditTx,
  authority: ReviewerCredentialAuthority,
  resultAuditEventId: string,
  outcome: "APPLIED" | "REPLAYED",
) {
  if (authority.consumed) {
    if (authority.consumed.resultAuditEventId !== resultAuditEventId) {
      throw new OperationalCommandError(409, "M3 reviewer authority grant was already consumed by another result");
    }
    return;
  }
  await appendPlatformAudit(tx, {
    actorUserId: authority.actorUserId,
    action: "M3_REVIEWER_AUTHORITY_CONSUMED",
    targetType: "m3-reviewer-authority",
    targetId: authority.grantFingerprint,
    metadata: M3ReviewerAuthorityGrantConsumptionMetadata.parse({
      schemaVersion: 1,
      operation: authority.operation,
      keyFingerprint: authority.keyFingerprint,
      grantAuditEventId: authority.grantAuditEventId,
      resultAuditEventId,
      outcome,
      consumedAt: authority.now.toISOString(),
    }),
    createdAt: authority.now,
  });
}

function replayConsumedRegistration(
  consumed: z.infer<typeof M3ReviewerAuthorityGrantConsumptionMetadata>,
  latest: Awaited<ReturnType<typeof latestCredentialEvent>>,
  metadata: z.infer<typeof M3ReviewerCredentialRegistrationMetadata>,
  keyFingerprint: string,
) {
  if (latest?.action !== "M3_REVIEWER_CREDENTIAL_REGISTERED" || consumed.resultAuditEventId !== latest.id) {
    throw new OperationalCommandError(409, "M3 reviewer authority grant was already consumed by another result");
  }
  const existing = M3ReviewerCredentialRegistrationMetadata.safeParse(latest.metadata);
  if (!existing.success || registrationIdentityFingerprint(existing.data) !== registrationIdentityFingerprint(metadata)) {
    throw new OperationalCommandError(409, "M3 reviewer authority grant was already consumed by different identity metadata");
  }
  return { replayed: true, keyFingerprint, auditEventId: latest.id, registeredAt: latest.createdAt };
}

function registrationIdentityFingerprint(metadata: z.infer<typeof M3ReviewerCredentialRegistrationMetadata>) {
  return commandFingerprint({
    reviewerId: metadata.reviewerId,
    reviewerNameFingerprint: metadata.reviewerNameFingerprint,
    reviewerRole: metadata.reviewerRole,
    credentialReferenceFingerprint: metadata.credentialReferenceFingerprint,
    keyFingerprint: metadata.keyFingerprint,
    publicKeyPem: metadata.publicKeyPem,
    verificationMethod: metadata.verificationMethod,
    verificationReferenceFingerprint: metadata.verificationReferenceFingerprint,
    verifiedAt: metadata.verifiedAt,
  });
}

function authorityGrantFingerprint(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function databaseNow(tx: AuditTx) {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  if (!clock?.now) throw new OperationalCommandError(503, "Database clock is unavailable");
  return clock.now;
}

async function lockAuthorityGrant(tx: AuditTx, grantFingerprint: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`m3-reviewer-authority:${grantFingerprint}`}, 0))
  `;
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
