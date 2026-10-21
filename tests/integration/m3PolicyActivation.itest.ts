import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { before, test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { GET as financeWorkspace } from "../../app/api/agent/finance/route";
import { POST as login, handleLogin } from "../../app/api/agent/auth/login/route";
import { POST as grantM3ReviewerAuthority } from "../../app/api/platform-admin/m3-reviewer-authority/route";
import {
  M3_HUMAN_ATTESTATION_CHECKLISTS,
  activateM3ApprovedPoliciesAndMaterializeExistingCases,
  applyM3ApprovedPolicyBundle,
  m3AttestationSigningPayload,
  m3AttestationFingerprint,
  m3PolicyContentFingerprint,
  m3ReviewerPublicKeyFingerprint,
  parseM3ApprovedPolicyBundle,
  type M3ApprovedPolicyBundle,
} from "../../lib/m3PolicyActivation";
import { commandFingerprint } from "../../lib/m3Command";
import {
  M3ReviewerAuthorityGrantMetadata,
  registerM3ReviewerCredential,
  requireActiveM3ReviewerCredential,
  revokeM3ReviewerCredential,
  runM3ReviewerCredentialTransaction,
} from "../../lib/m3ReviewerCredential";
import { checkCaseRequirementMaterializationParity } from "../../lib/documentRequirementService";
import { hashPassword } from "../../lib/password";
import {
  encryptPlatformMfaSecret,
  generatePlatformMfaSecret,
  totp,
} from "../../lib/platformMfa";
import {
  createFixtureContext,
  db,
  makeRequest,
  skip,
  type FixtureMember,
} from "./_setup";
import { signSession, SESSION_COOKIE, requireAppEncryptionKey } from "../../lib/session";
import { enforcePersistentRateLimit, persistentRateLimitKey } from "../../lib/persistentRateLimit";
import { assertM3ProductionActivation, runM3ProductionTransaction } from "../../lib/m3ProductionActivation";
import { PATCH as intakePatch } from "../../app/api/agent/cases/[caseId]/intake/route";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };
const intakeTraces = new AsyncLocalStorage<{ operations: string[]; timings: Array<{ operation: string; ms: number }>; transactionMs: number[]; errors: string[]; proofReads: number }>();
before(() => {
  if (skip) return;
  db.$transaction = new Proxy(db.$transaction, {
    async apply(target, receiver, args) {
      const trace = intakeTraces.getStore();
      const start = performance.now();
      if (trace && typeof args[0] === "function") {
        const work = args[0];
        args[0] = (tx: Prisma.TransactionClient) => work(new Proxy(tx, {
          get(client, property, proxy) {
            if (property !== "$queryRaw") return Reflect.get(client, property, proxy);
            return (...parameters: unknown[]) => {
              const sql = parameters[0];
              const text = Array.isArray(sql) ? sql.join("?")
                : sql && typeof sql === "object" && "strings" in sql && Array.isArray(sql.strings) ? sql.strings.join("?") : "";
              if (text.includes('LEFT JOIN "M3ProductionActivation"')) trace.proofReads++;
              return (client.$queryRaw as (...values: unknown[]) => unknown).apply(client, parameters);
            };
          },
        }));
      }
      try { return await Reflect.apply(target, receiver, args); }
      finally { trace?.transactionMs.push(performance.now() - start); }
    },
  });
  db.$use(async (params, next) => {
    const trace = intakeTraces.getStore();
    const operation = `${params.model ?? "raw"}.${params.action}`;
    trace?.operations.push(operation);
    const started = performance.now();
    try { return await next(params); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code && ["P2028", "P2034", "P2010"].includes(code)) intakeTraces.getStore()?.errors.push(code);
      throw error;
    }
    finally { trace?.timings.push({ operation, ms: Math.round(performance.now() - started) }); }
  });
});
const ACTIVATION_POLICY_VERSION = 3_000_002;
const AUTHORITY_RATE_LIMIT_BUCKET = "m3-reviewer-authority-grant";
const authorityRateLimitKeys = new Set<string>();
let authorityRequestSequence = 0;
type ReviewerRole = "FINANCE_ACCOUNTING" | "LEGAL_PRIVACY" | "RITUAL_OPERATIONS_SME";
const REVIEWER_KEYS = Object.fromEntries(
  (["FINANCE_ACCOUNTING", "LEGAL_PRIVACY", "RITUAL_OPERATIONS_SME"] as const).map((role) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    return [role, { privateKey, publicKeyPem, keyFingerprint: m3ReviewerPublicKeyFingerprint(publicKeyPem) }];
  }),
) as Record<ReviewerRole, { privateKey: KeyObject; publicKeyPem: string; keyFingerprint: string }>;

test("persistent rate limits remain exact under concurrent requests", opts, async () => {
  const bucket = `m3-rate-limit-concurrency-${process.pid}`;
  const clientAddress = `2001:db8:ffff::${process.pid.toString(16)}`;
  const keyHash = persistentRateLimitKey(bucket, clientAddress);
  authorityRateLimitKeys.add(keyHash);
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, () => enforcePersistentRateLimit(
      makeRequest("/api/platform-admin/m3-reviewer-authority", {
        method: "POST",
        headers: { "x-real-ip": clientAddress },
      }),
      bucket,
      3,
      15 * 60_000,
    )));
    assert.equal(responses.filter((response) => response == null).length, 3);
    assert.equal(responses.filter((response) => response?.status === 429).length, 5);
    const persisted = await db.securityRateLimitBucket.findUniqueOrThrow({ where: { keyHash } });
    assert.equal(persisted.count, 8);
  } finally {
    await cleanupAuthorityRateLimitKeys();
  }
});

test("M3 reviewer credential registry is SUPER_ADMIN-controlled, idempotent and permanently revocable", opts, async () => {
  const fixtures = createFixtureContext("m3-reviewer-registry");
  try {
    const organizationId = await fixtures.makeOrganization("reviewer-registry");
    const actor = await fixtures.makeMember("registry-actor", { organizationId, role: "ADMIN" });
    const actorSessionVersion = (await db.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { sessionVersion: true },
    })).sessionVersion;
    const credential = REVIEWER_KEYS.FINANCE_ACCOUNTING;
    const input = {
      schemaVersion: 1 as const,
      reviewerId: "synthetic-finance-registry-reviewer",
      reviewerName: "Synthetic Finance Registry Reviewer",
      reviewerRole: "FINANCE_ACCOUNTING" as const,
      publicKeyPem: credential.publicKeyPem,
      verificationMethod: "VIDEO_CALL" as const,
      verificationReference: "synthetic-controlled-channel-assertion",
      verifiedAt: "2026-01-01T08:00:00.000Z",
    };
    const authoritySession = await reviewerAuthoritySession(actor.userId, actorSessionVersion);
    const denied = await requestReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REGISTER",
      credential.keyFingerprint,
      authoritySession,
    );
    assert.equal(denied.status, 403);
    await db.user.update({
      where: { id: actor.userId },
      data: { platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() },
    });
    const staleSession = reviewerAuthoritySessionAt(
      actor.userId,
      actorSessionVersion,
      Math.floor(Date.now() / 1_000) - (7 * 60 * 60),
    );
    const staleSessionResponse = await requestReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REGISTER",
      credential.keyFingerprint,
      staleSession,
    );
    assert.equal(staleSessionResponse.status, 403);
    const grantResponse = await requestReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REGISTER",
      credential.keyFingerprint,
      authoritySession,
    );
    assert.equal(grantResponse.status, 201);
    const routeGrant = await grantResponse.json() as {
      authorityGrant: string;
      expiresAt: string;
      auditEventId: string;
    };
    assert.match(routeGrant.authorityGrant, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Date.parse(routeGrant.expiresAt) > Date.now(), true);
    const grantAudit = await db.platformAuditEvent.findUniqueOrThrow({
      where: { id: routeGrant.auditEventId },
      select: { action: true, targetType: true, metadata: true },
    });
    assert.equal(grantAudit.action, "M3_REVIEWER_AUTHORITY_GRANTED");
    assert.equal(grantAudit.targetType, "m3-reviewer-authority");
    assert.equal((grantAudit.metadata as Record<string, unknown>).schemaVersion, 2);
    assert.equal(Number.isFinite(Date.parse(String(
      (grantAudit.metadata as Record<string, unknown>).authoritySessionIssuedAt,
    ))), true);
    assert.equal(JSON.stringify(grantAudit).includes(routeGrant.authorityGrant), false);
    await assert.rejects(
      db.platformAuditEvent.update({
        where: { id: routeGrant.auditEventId },
        data: { targetId: "forbidden-platform-audit-mutation" },
      }),
      /PlatformAuditEvent is append-only/,
    );
    await assert.rejects(
      db.platformAuditEvent.delete({ where: { id: routeGrant.auditEventId } }),
      /PlatformAuditEvent is append-only/,
    );
    await assert.rejects(
      runM3ReviewerCredentialTransaction(
        db,
        (tx) => registerM3ReviewerCredential(tx, "A".repeat(43), input),
      ),
      /authority grant is required|grant is missing/,
    );
    const staleToken = "S".repeat(43);
    const staleGrantFingerprint = createHash("sha256").update(staleToken).digest("hex");
    const staleIssuedAt = new Date("2020-01-01T00:00:00.000Z");
    await db.platformAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        action: "M3_REVIEWER_AUTHORITY_GRANTED",
        targetType: "m3-reviewer-authority",
        targetId: staleGrantFingerprint,
        metadata: M3ReviewerAuthorityGrantMetadata.parse({
          schemaVersion: 2,
          operation: "REGISTER",
          keyFingerprint: credential.keyFingerprint,
          actorUserId: actor.userId,
          actorPlatformRoleAtEvent: "SUPER_ADMIN",
          authoritySessionVersion: actorSessionVersion,
          authorityMfaVerified: true,
          authoritySessionIssuedAt: staleIssuedAt.toISOString(),
          issuedAt: staleIssuedAt.toISOString(),
          expiresAt: "2020-01-01T00:15:00.000Z",
        }),
        createdAt: staleIssuedAt,
      },
    });
    await assert.rejects(
      runM3ReviewerCredentialTransaction(
        db,
        (tx) => registerM3ReviewerCredential(tx, staleToken, input),
      ),
      /invalid or expired/,
    );
    const futureGrant = await issueReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REGISTER",
      credential.keyFingerprint,
    );
    await assert.rejects(
      runM3ReviewerCredentialTransaction(db, (tx) => registerM3ReviewerCredential(tx, futureGrant.token, {
        ...input,
        verifiedAt: "2099-01-01T00:00:00.000Z",
      })),
      /cannot be future-dated/,
    );
    const first = await runM3ReviewerCredentialTransaction(
      db,
      (tx) => registerM3ReviewerCredential(tx, routeGrant.authorityGrant, input),
    );
    const replay = await runM3ReviewerCredentialTransaction(
      db,
      (tx) => registerM3ReviewerCredential(tx, routeGrant.authorityGrant, input),
    );
    const freshReplayGrant = await issueReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REGISTER",
      credential.keyFingerprint,
    );
    const freshReplay = await runM3ReviewerCredentialTransaction(
      db,
      (tx) => registerM3ReviewerCredential(tx, freshReplayGrant.token, input),
    );
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(freshReplay.replayed, true);
    assert.equal(replay.auditEventId, first.auditEventId);
    assert.equal(freshReplay.auditEventId, first.auditEventId);
    assert.equal(await db.platformAuditEvent.count({
      where: { targetType: "m3-reviewer-credential", targetId: credential.keyFingerprint },
    }), 1);
    const registrationAudit = await db.platformAuditEvent.findUniqueOrThrow({
      where: { id: first.auditEventId },
      select: { actorUserId: true, metadata: true },
    });
    assert.equal(registrationAudit.actorUserId, actor.userId);
    const authorityMetadata = registrationAudit.metadata as Record<string, unknown>;
    assert.equal(authorityMetadata.authorityProofType, "ONE_TIME_PLATFORM_AUTHORITY_GRANT");
    assert.equal(authorityMetadata.authoritySessionVersion, actorSessionVersion);
    assert.equal(authorityMetadata.authorityGrantAuditEventId, routeGrant.auditEventId);
    assert.equal(Number.isFinite(Date.parse(String(authorityMetadata.authorityGrantIssuedAt))), true);
    const conflictingGrant = await issueReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REGISTER",
      credential.keyFingerprint,
    );
    await assert.rejects(
      runM3ReviewerCredentialTransaction(db, (tx) => registerM3ReviewerCredential(tx, conflictingGrant.token, {
        ...input,
        reviewerName: "Conflicting Synthetic Reviewer",
      })),
      /different verified identity metadata/,
    );

    await db.user.update({ where: { id: actor.userId }, data: { platformRole: "USER" } });
    await assert.doesNotReject(runM3ReviewerCredentialTransaction(db, (tx) => requireActiveM3ReviewerCredential(tx, {
      reviewerId: input.reviewerId,
      reviewerName: input.reviewerName,
      reviewerRole: input.reviewerRole,
      publicKeyPem: input.publicKeyPem,
      keyFingerprint: credential.keyFingerprint,
    })));

    await db.user.update({ where: { id: actor.userId }, data: { platformRole: "SUPER_ADMIN" } });
    const revokeGrant = await issueReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REVOKE",
      credential.keyFingerprint,
    );
    const revoked = await runM3ReviewerCredentialTransaction(db, (tx) => revokeM3ReviewerCredential(
      tx,
      revokeGrant.token,
      credential.keyFingerprint,
      "ROTATED",
    ));
    const revokedReplay = await runM3ReviewerCredentialTransaction(db, (tx) => revokeM3ReviewerCredential(
      tx,
      revokeGrant.token,
      credential.keyFingerprint,
      "ROTATED",
    ));
    const freshRevokeGrant = await issueReviewerAuthorityGrant(
      actor.userId,
      actorSessionVersion,
      "REVOKE",
      credential.keyFingerprint,
    );
    const freshRevokedReplay = await runM3ReviewerCredentialTransaction(db, (tx) => revokeM3ReviewerCredential(
      tx,
      freshRevokeGrant.token,
      credential.keyFingerprint,
      "ROTATED",
    ));
    assert.equal(revoked.replayed, false);
    assert.equal(revokedReplay.replayed, true);
    assert.equal(freshRevokedReplay.replayed, true);
    assert.equal(revokedReplay.auditEventId, revoked.auditEventId);
    await assert.rejects(
      runM3ReviewerCredentialTransaction(db, (tx) => requireActiveM3ReviewerCredential(tx, {
        reviewerId: input.reviewerId,
        reviewerName: input.reviewerName,
        reviewerRole: input.reviewerRole,
        publicKeyPem: input.publicKeyPem,
        keyFingerprint: credential.keyFingerprint,
      })),
      /not actively registered/,
    );
  } finally {
    await cleanupAuthorityRateLimitKeys();
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M3 reviewer credential registry serializes concurrent register and revoke commands", opts, async () => {
  const fixtures = createFixtureContext("m3-reviewer-registry-race");
  try {
    const organizationId = await fixtures.makeOrganization("reviewer-registry-race");
    const actor = await fixtures.makeMember("registry-race-actor", { organizationId, role: "ADMIN" });
    const actorRecord = await db.user.update({
      where: { id: actor.userId },
      data: { platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() },
      select: { sessionVersion: true },
    });
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    const keyFingerprint = m3ReviewerPublicKeyFingerprint(publicKeyPem);
    const input = {
      schemaVersion: 1 as const,
      reviewerId: "synthetic-finance-registry-race-reviewer",
      reviewerName: "Synthetic Finance Registry Race Reviewer",
      reviewerRole: "FINANCE_ACCOUNTING" as const,
      publicKeyPem,
      verificationMethod: "VIDEO_CALL" as const,
      verificationReference: "synthetic-controlled-race-assertion",
      verifiedAt: "2026-01-01T08:00:00.000Z",
    };
    const registrationGrants = await Promise.all([
      issueReviewerAuthorityGrant(actor.userId, actorRecord.sessionVersion, "REGISTER", keyFingerprint),
      issueReviewerAuthorityGrant(actor.userId, actorRecord.sessionVersion, "REGISTER", keyFingerprint),
    ]);

    const registrations = await Promise.all([
      runM3ReviewerCredentialTransaction(
        db,
        (tx) => registerM3ReviewerCredential(tx, registrationGrants[0].token, input),
      ),
      runM3ReviewerCredentialTransaction(
        db,
        (tx) => registerM3ReviewerCredential(tx, registrationGrants[1].token, input),
      ),
    ]);
    assert.deepEqual(registrations.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(new Set(registrations.map((result) => result.auditEventId)).size, 1);
    assert.equal(await db.platformAuditEvent.count({
      where: { targetType: "m3-reviewer-credential", targetId: keyFingerprint },
    }), 1);

    const replayGrant = await issueReviewerAuthorityGrant(
      actor.userId,
      actorRecord.sessionVersion,
      "REGISTER",
      keyFingerprint,
    );
    const revokeGrant = await issueReviewerAuthorityGrant(
      actor.userId,
      actorRecord.sessionVersion,
      "REVOKE",
      keyFingerprint,
    );
    const [registerRace, revokeRace] = await Promise.allSettled([
      runM3ReviewerCredentialTransaction(
        db,
        (tx) => registerM3ReviewerCredential(tx, replayGrant.token, input),
      ),
      runM3ReviewerCredentialTransaction(
        db,
        (tx) => revokeM3ReviewerCredential(tx, revokeGrant.token, keyFingerprint, "ROTATED"),
      ),
    ]);
    assert.equal(revokeRace.status, "fulfilled");
    if (registerRace.status === "rejected") {
      assert.match(String(registerRace.reason), /Revoked M3 reviewer credentials cannot be reactivated/);
    } else {
      assert.equal(registerRace.value.replayed, true);
    }
    assert.equal(await db.platformAuditEvent.count({
      where: { targetType: "m3-reviewer-credential", targetId: keyFingerprint },
    }), 2);
    await assert.rejects(
      runM3ReviewerCredentialTransaction(db, (tx) => requireActiveM3ReviewerCredential(tx, {
        reviewerId: input.reviewerId,
        reviewerName: input.reviewerName,
        reviewerRole: input.reviewerRole,
        publicKeyPem,
        keyFingerprint,
      })),
      /not actively registered/,
    );
  } finally {
    await cleanupAuthorityRateLimitKeys();
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M3 approved policy activation is human-attested, idempotent and retires prior versions", opts, async () => {
  const fixtures = createFixtureContext("m3-policy-activation");
  try {
    const organizationId = await fixtures.makeOrganization("approved-policy");
    const otherOrganizationId = await fixtures.makeOrganization("other-approved-policy");
    const approverMember = await fixtures.makeMember("policy-approver", { organizationId, role: "ADMIN" });
    const approver = await db.user.update({
      where: { id: approverMember.userId },
      data: { platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() },
      select: { id: true, sessionVersion: true },
    });
    const firstBundle = baselinePolicyBundle(organizationId, approver.id);
    const registrationGrants = await issueReviewerRegistrationGrants(firstBundle, approver);
    const revocationGrant = await issueReviewerAuthorityGrant(
      approver.id,
      approver.sessionVersion,
      "REVOKE",
      firstBundle.attestations.finance.signature.keyFingerprint,
    );
    // Exercise immutable activation inside one rollback-only transaction. Identical
    // policy codes in a second tenant must not retire or rewrite the first tenant.
    await assert.rejects(db.$transaction(async (tx) => {
      await assert.rejects(
        applyM3ApprovedPolicyBundle(tx, firstBundle, humanSignoffs(firstBundle)),
        /reviewer credential is not actively registered/,
      );
      await registerReviewerCredentials(tx, firstBundle, registrationGrants);
      const first = await applyM3ApprovedPolicyBundle(tx, firstBundle, humanSignoffs(firstBundle));
      const replay = await applyM3ApprovedPolicyBundle(tx, firstBundle, humanSignoffs(firstBundle));
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.bundleFingerprint, first.bundleFingerprint);
      assert.equal(await tx.platformAuditEvent.count({
        where: { actorUserId: approver.id, action: "M3_POLICIES_ACTIVATED" },
      }), 1);
      const activationAudit = await tx.platformAuditEvent.findFirstOrThrow({
        where: {
          actorUserId: approver.id,
          action: "M3_POLICIES_ACTIVATED",
          targetId: organizationId,
        },
        select: { metadata: true },
      });
      const auditMetadata = activationAudit.metadata as Record<string, unknown>;
      assert.equal(auditMetadata.releaseDeploymentId, firstBundle.releaseCandidate.deploymentId);
      assert.equal(auditMetadata.releaseDeploymentSha, firstBundle.releaseCandidate.deploymentSha);
      assert.equal(auditMetadata.releaseImplementationSha, firstBundle.releaseCandidate.implementationSha);
      assert.equal(auditMetadata.releaseDatabaseFingerprint, firstBundle.releaseCandidate.databaseFingerprint);
      assert.equal(JSON.stringify(auditMetadata).includes("Synthetic checklist result"), false);
      assert.equal(JSON.stringify(auditMetadata).includes("Synthetic human verdict fixture"), false);
      assert.equal(JSON.stringify(auditMetadata).includes("platform-audit-key:"), false);
      assert.match(JSON.stringify(auditMetadata), /FINANCE_ACCOUNTING/);
      assert.match(JSON.stringify(auditMetadata), /entry-policy/);
      assert.equal(await tx.contractSigningPolicy.count({ where: { organizationId, status: "APPROVED" } }), 1);
      assert.equal(await tx.financialControlPolicy.count({ where: { organizationId, status: "APPROVED" } }), 1);

      const otherBundle = baselinePolicyBundle(otherOrganizationId, approver.id);
      const other = await applyM3ApprovedPolicyBundle(tx, otherBundle, humanSignoffs(otherBundle));
      assert.equal(other.replayed, false);
      assert.equal(await tx.documentRequirementPolicy.count({
        where: { organizationId, status: "APPROVED", retiredAt: null },
      }), 2);
      assert.equal(await tx.documentRequirementPolicy.count({
        where: { organizationId: otherOrganizationId, status: "APPROVED", retiredAt: null },
      }), 2);
      assert.equal(await tx.documentTypeDefinition.count({
        where: { organizationId, status: "APPROVED" },
      }), 5);
      assert.equal(await tx.documentTypeDefinition.count({
        where: { organizationId: otherOrganizationId, status: "APPROVED" },
      }), 5);

      const conflictingBundle = signedPolicyBundle({
        ...policyContent(firstBundle),
        signingPolicy: { ...firstBundle.signingPolicy, source: "Conflicting signed policy content" },
      });
      await assert.rejects(
        applyM3ApprovedPolicyBundle(tx, conflictingBundle, humanSignoffs(conflictingBundle)),
        /conflicts with approved bundle/,
      );
      assert.equal(await tx.platformAuditEvent.count({
        where: {
          actorUserId: approver.id,
          action: "M3_POLICIES_ACTIVATED",
          targetId: organizationId,
        },
      }), 1);
      await revokeM3ReviewerCredential(
        tx,
        revocationGrant.token,
        firstBundle.attestations.finance.signature.keyFingerprint,
        "CREDENTIAL_COMPROMISED",
      );
      await assert.rejects(
        applyM3ApprovedPolicyBundle(tx, firstBundle, humanSignoffs(firstBundle)),
        /reviewer credential registry|reviewer credential is not actively registered/,
      );
      throw new Error("ROLLBACK_M3_POLICY_ACTIVATION_TEST");
    }, { timeout: 20_000 }), /ROLLBACK_M3_POLICY_ACTIVATION_TEST/);
  } finally {
    await cleanupAuthorityRateLimitKeys();
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M3 policy activation materializes requirements for existing pilot cases without duplicates", opts, async () => {
  const fixtures = createFixtureContext("m3-policy-existing-case");
  try {
    const organizationId = await fixtures.makeOrganization("existing-case-policy");
    const owner = await fixtures.makeMember("owner", { organizationId, role: "AGENT" });
    const existingCase = await fixtures.makeCase(owner, "existing-case");
    const laterCase = await fixtures.makeCase(owner, "later-case");
    await db.case.update({ where: { id: existingCase.id }, data: { scenarioId: "CREMATION_V1" } });
    await db.case.update({ where: { id: laterCase.id }, data: { scenarioId: "UNSELECTED" } });
    const approverMember = await fixtures.makeMember("policy-approver", { organizationId, role: "ADMIN" });
    const approver = await db.user.update({
      where: { id: approverMember.userId },
      data: { platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() },
      select: { id: true, sessionVersion: true },
    });
    const bundle = baselinePolicyBundle(organizationId, approver.id);
    const registrationGrants = await issueReviewerRegistrationGrants(bundle, approver);
    await assert.rejects(db.$transaction(async (tx) => {
      await registerReviewerCredentials(tx, bundle, registrationGrants);
      const first = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        bundle,
        humanSignoffs(bundle),
        "synthetic-policy-run-0001",
        new Date("2026-08-13T10:00:00.000Z"),
      );
      assert.deepEqual(first.materialization, {
        casesExamined: 1,
        casesMaterialized: 1,
        casesPinnedToExistingPolicy: 0,
        casesDeferredUntilPolicyEffective: 0,
        requirementsCreated: 3,
        requirementsExisting: 0,
      });
      assert.equal(await tx.caseDocumentRequirement.count({ where: { caseId: existingCase.id } }), 3);
      const replay = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        bundle,
        humanSignoffs(bundle),
        "synthetic-policy-run-0002",
        new Date("2026-08-13T10:00:00.000Z"),
      );
      assert.equal(replay.replayed, true);
      assert.equal(replay.materialization.requirementsCreated, 0);
      assert.equal(replay.materialization.requirementsExisting, 3);
      assert.equal(replay.materialization.casesMaterialized, 0);
      assert.equal(replay.materialization.casesPinnedToExistingPolicy, 1);
      assert.equal(await tx.caseDocumentRequirement.count({ where: { caseId: existingCase.id } }), 3);

      await tx.case.update({ where: { id: laterCase.id }, data: { scenarioId: "CREMATION_V1" } });
      const upgradedBundle = signedPolicyBundle({
        ...policyContent(bundle),
        approvedAt: "2026-08-13T11:00:00.000Z",
        effectiveFrom: "2026-08-13T11:00:00.000Z",
        documentPolicies: bundle.documentPolicies.map((policy) => ({
          ...policy,
          version: policy.version + 1,
          source: `${policy.source}:UPGRADED`,
        })),
        signingPolicy: {
          ...bundle.signingPolicy,
          version: `${bundle.signingPolicy.version}-v2`,
        },
        financialPolicy: {
          ...bundle.financialPolicy,
          version: bundle.financialPolicy.version + 1,
        },
      });
      const upgrade = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        upgradedBundle,
        humanSignoffs(upgradedBundle),
        "synthetic-policy-run-0003",
        new Date("2026-08-13T11:00:01.000Z"),
      );
      assert.deepEqual(upgrade.materialization, {
        casesExamined: 2,
        casesMaterialized: 1,
        casesPinnedToExistingPolicy: 1,
        casesDeferredUntilPolicyEffective: 0,
        requirementsCreated: 3,
        requirementsExisting: 3,
      });
      const [existingRequirements, laterRequirements] = await Promise.all([
        tx.caseDocumentRequirement.findMany({ where: { caseId: existingCase.id }, select: { policyVersion: true } }),
        tx.caseDocumentRequirement.findMany({ where: { caseId: laterCase.id }, select: { policyVersion: true } }),
      ]);
      assert.deepEqual([...new Set(existingRequirements.map((item) => item.policyVersion))], [ACTIVATION_POLICY_VERSION]);
      assert.deepEqual([...new Set(laterRequirements.map((item) => item.policyVersion))], [ACTIVATION_POLICY_VERSION + 1]);
      assert.equal(existingRequirements.length, 3);
      assert.equal(laterRequirements.length, 3);
      assert.equal((await checkCaseRequirementMaterializationParity(
        tx, organizationId, existingCase.id, "CREMATION_V1",
      )).ok, true);
      assert.equal((await checkCaseRequirementMaterializationParity(
        tx, organizationId, laterCase.id, "CREMATION_V1",
      )).ok, true);

      const upgradeReplay = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        upgradedBundle,
        humanSignoffs(upgradedBundle),
        "synthetic-policy-run-0004",
        new Date("2026-08-13T11:00:01.000Z"),
      );
      assert.equal(upgradeReplay.replayed, true);
      assert.equal(upgradeReplay.materialization.casesMaterialized, 0);
      assert.equal(upgradeReplay.materialization.casesPinnedToExistingPolicy, 2);
      assert.equal(upgradeReplay.materialization.requirementsCreated, 0);
      assert.equal(upgradeReplay.materialization.requirementsExisting, 6);
      assert.equal(await tx.caseDocumentRequirement.count({
        where: { caseId: { in: [existingCase.id, laterCase.id] } },
      }), 6);
      assert.equal(await tx.operationalAuditEvent.count({
        where: {
          organizationId,
          entityId: existingCase.id,
          action: "document_requirements.materialized.v1",
          actorType: "platform-policy-operator",
        },
      }), 1);
      assert.equal(await tx.operationalAuditEvent.count({
        where: {
          organizationId,
          entityId: laterCase.id,
          action: "document_requirements.materialized.v1",
          actorType: "platform-policy-operator",
        },
      }), 1);
      throw new Error("ROLLBACK_M3_EXISTING_CASE_POLICY_TEST");
    }, { timeout: 20_000 }), /ROLLBACK_M3_EXISTING_CASE_POLICY_TEST/);
  } finally {
    await cleanupAuthorityRateLimitKeys();
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M3 Finance login and API require current-session TOTP verification", opts, async () => {
  const fixtures = createFixtureContext("m3-finance-mfa");
  const password = "M3-Synthetic-Finance-Password-42!";
  const secret = generatePlatformMfaSecret();
  try {
    const finance = await fixtures.makeMember("finance", { role: "FINANCE" });
    const email = (await db.user.findUniqueOrThrow({ where: { id: finance.userId }, select: { email: true } })).email!;
    await db.user.update({
      where: { id: finance.userId },
      data: { passwordHash: hashPassword(password) },
    });
    const loginRateLimitKey = persistentRateLimitKey("login-account", email);
    authorityRateLimitKeys.add(loginRateLimitKey);
    // Exercise the real SQL window without letting KDF duration consume that window.
    // Actual password/KDF and MFA verification remain covered below and in auth unit tests.
    let rejectedPasswordChecks = 0;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const ip = `2001:db8:30::${attempt}`;
      authorityRateLimitKeys.add(persistentRateLimitKey("login-ip", ip));
      const rejected = await handleLogin(makeRequest("/api/agent/auth/login", {
        method: "POST",
        headers: { "x-real-ip": ip },
        body: { email, password: "wrong-password" },
      }), { verifyPassword: () => { rejectedPasswordChecks += 1; return false; } });
      assert.equal(rejected.status, 401);
      assert.equal(rejected.headers.get("set-cookie"), null);
    }
    assert.equal(rejectedPasswordChecks, 10);
    const finalIp = "2001:db8:30::ffff";
    authorityRateLimitKeys.add(persistentRateLimitKey("login-ip", finalIp));
    const throttled = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-real-ip": finalIp },
      body: { email, password },
    }));
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get("set-cookie"), null);
    assert.equal((await db.securityRateLimitBucket.findUniqueOrThrow({
      where: { keyHash: loginRateLimitKey },
    })).count, 11);
    await db.securityRateLimitBucket.delete({ where: { keyHash: loginRateLimitKey } });
    authorityRateLimitKeys.add(loginRateLimitKey);

    const setupLogin = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.30.1" },
      body: { email, password },
    }));
    assert.equal(setupLogin.status, 200);
    assert.equal((await setupLogin.clone().json()).redirectTo, "/setup/platform-admin-mfa");
    const unverifiedCookie = setupLogin.headers.get("set-cookie")?.split(";")[0];
    assert.ok(unverifiedCookie);
    assert.equal((await financeWorkspace(makeRequest("/api/agent/finance", { cookie: unverifiedCookie }))).status, 403);

    await db.user.update({
      where: { id: finance.userId },
      data: {
        platformMfaSecretEncrypted: encryptPlatformMfaSecret(secret),
        platformMfaEnabledAt: new Date(),
      },
    });
    const challenge = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.30.2" },
      body: { email, password },
    }));
    assert.equal(challenge.status, 200);
    assert.equal((await challenge.json()).mfaRequired, true);
    assert.equal(challenge.headers.get("set-cookie"), null);

    const authenticated = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.30.3" },
      body: { email, password, mfaCode: totp(secret) },
    }));
    assert.equal(authenticated.status, 200);
    assert.equal((await authenticated.clone().json()).redirectTo, "/agent/finance");
    const cookie = authenticated.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    assert.equal((await financeWorkspace(makeRequest("/api/agent/finance", { cookie }))).status, 200);
    assert.equal((await financeWorkspace(makeRequest("/api/agent/finance", { cookie: unverifiedCookie }))).status, 403);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("real Production M3 requires exact immutable proof, both scenarios and active human credentials; retirement/revocation fail closed", opts, async () => {
  const fixtures = createFixtureContext("m3-real-policy-proof");
  const previousEnv = process.env.VERCEL_ENV;
  const previousBindings = process.env.M3_PRODUCTION_POLICY_BINDINGS;
  try {
    const organizationId = await fixtures.makeOrganization("real-proof");
    const approverMember = await fixtures.makeMember("approver", { organizationId, role: "ADMIN" });
    const approver = await db.user.update({ where: { id: approverMember.userId }, data: { platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() }, select: { id: true, sessionVersion: true } });
    const content = policyContent(baselinePolicyBundle(organizationId, approver.id));
    content.documentPolicies.find(policy => policy.scenario === "FAMILY_PLOT_BURIAL_V1")!.rules.push({
      ...rule("responsible-for-burial-confirmation", "M3_IT_RELATIONSHIP_V1", "responsible-party-match"),
      kind: "CONDITIONAL", conditionKey: "HAS_RESPONSIBLE_FOR_BURIAL",
      conditionExplanation: "Synthetic applicability regression, not a legal requirement",
    });
    const bundle = signedPolicyBundle(content);
    const grants = await issueReviewerRegistrationGrants(bundle, approver);
    await db.$transaction(async tx => {
      await registerReviewerCredentials(tx, bundle, grants);
      const first = await applyM3ApprovedPolicyBundle(tx, bundle, humanSignoffs(bundle));
      assert.equal((await applyM3ApprovedPolicyBundle(tx, bundle, humanSignoffs(bundle))).replayed, true);
      assert.equal(await tx.m3ProductionActivation.count({ where: { organizationId } }), 1);
      const proof = await tx.m3ProductionActivation.findFirstOrThrow({ where: { organizationId } });
      assert.equal(commandFingerprint(proof.bundle), first.bundleFingerprint);
    });
    process.env.VERCEL_ENV = "production";
    process.env.M3_PRODUCTION_POLICY_BINDINGS = JSON.stringify({ [organizationId]: commandFingerprint(bundle) });
    await runM3ProductionTransaction(organizationId, async tx => {
      await assertM3ProductionActivation(tx, organizationId);
      assert.equal(await tx.m3ProductionActivation.count({ where: { organizationId } }), 1);
    });
    await verifyProductionProofIntakes(bundle, fixtures, approverMember);
    await verifyProofActivationLockOrder(bundle);
    await verifyProofAuditForeignKeyLockOrder(bundle, fixtures, approverMember);
    const rollback = new Error("SYNTHETIC_ROLLBACK_ONLY");
    for (const kind of ["documentType", "scenario", "signing", "finance"] as const) {
      await assert.rejects(db.$transaction(async tx => {
        if (kind === "documentType") await tx.documentTypeDefinition.updateMany({ where: { organizationId, status: "APPROVED" }, data: { status: "RETIRED" } });
        if (kind === "scenario") await tx.documentRequirementPolicy.updateMany({ where: { organizationId, scenario: "CREMATION_V1", status: "APPROVED" }, data: { status: "RETIRED", retiredAt: new Date() } });
        if (kind === "signing") await tx.contractSigningPolicy.updateMany({ where: { organizationId, status: "APPROVED" }, data: { status: "RETIRED", retiredAt: new Date() } });
        if (kind === "finance") await tx.financialControlPolicy.updateMany({ where: { organizationId, status: "APPROVED" }, data: { status: "RETIRED" } });
        await assert.rejects(assertM3ProductionActivation(tx, organizationId), { status: 503, code: "M3_PRODUCTION_POLICY_UNAVAILABLE" });
        throw rollback;
      }), error => error === rollback);
    }
    const revocationGrant = await issueReviewerAuthorityGrant(approver.id, approver.sessionVersion, "REVOKE", bundle.attestations.finance.signature.keyFingerprint);
    await assert.rejects(db.$transaction(async tx => {
      await revokeM3ReviewerCredential(tx, revocationGrant.token, bundle.attestations.finance.signature.keyFingerprint, "REVIEWER_OFFBOARDED");
      await assert.rejects(assertM3ProductionActivation(tx, organizationId), /not actively registered/);
      throw rollback;
    }), error => error === rollback);
    process.env.M3_PRODUCTION_POLICY_BINDINGS = JSON.stringify({ [organizationId]: "f".repeat(64) });
    await assert.rejects(runM3ProductionTransaction(organizationId, async () => { throw new Error("UNREACHABLE_MUTATION"); }), { status: 503 });
    process.env.M3_PRODUCTION_POLICY_BINDINGS = JSON.stringify({ [organizationId]: commandFingerprint(bundle) });
    const proof = await db.m3ProductionActivation.findFirstOrThrow({ where: { organizationId } });
    await assert.rejects(db.m3ProductionActivation.update({ where: { id: proof.id }, data: { bundleFingerprint: "e".repeat(64) } }), /immutable/);
    await assert.rejects(db.m3ProductionActivation.delete({ where: { id: proof.id } }), /immutable/);
    assert.equal(await db.m3ProductionActivation.count({ where: { organizationId } }), 1);
    await verifyReviewerEpochConcurrency(bundle, revocationGrant.token);
  } finally {
    if (previousEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousEnv;
    if (previousBindings === undefined) delete process.env.M3_PRODUCTION_POLICY_BINDINGS; else process.env.M3_PRODUCTION_POLICY_BINDINGS = previousBindings;
    await cleanupAuthorityRateLimitKeys();
    await fixtures.cleanup(); await fixtures.assertNoResidue();
  }
});

async function verifyProductionProofIntakes(bundle: M3ApprovedPolicyBundle, fixtures: ReturnType<typeof createFixtureContext>, actor: FixtureMember) {
  actor = await fixtures.makeMember("proof-intake-agent", { organizationId: actor.organizationId, role: "AGENT" });
  await fixtures.makeMember("proof-intake-reviewer", { organizationId: actor.organizationId, role: "DOCUMENT_REVIEWER" });
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { sessionVersion: true } });
  const cookie = `${SESSION_COOKIE}=${await signSession({ userId: actor.userId, sessionVersion: user.sessionVersion,
    activeMembershipId: actor.membershipId, mfaVerified: true })}`;
  const endpoint = process.env.M3_INTAKE_LATENCY_CONTROL_URL;
  const control = async (active: boolean) => {
    if (!endpoint) return;
    const url = new URL(endpoint);
    assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
    assert.equal((await fetch(url, { method: "POST", body: JSON.stringify({ active }) })).status, 204);
  };
  for (const [scenario, ceremonyType, ruleCount] of [["CREMATION_V1", "кремация", 3], ["FAMILY_PLOT_BURIAL_V1", "погребение", 5]] as const) {
    const record = await fixtures.makeCase(actor, `proof-intake-${scenario}`);
    const trace = { operations: [] as string[], timings: [] as Array<{ operation: string; ms: number }>, transactionMs: [] as number[], errors: [] as string[], proofReads: 0 };
    await control(true);
    let response: Response;
    try {
      response = await intakeTraces.run(trace, () => intakePatch(makeRequest(`/api/agent/cases/${record.leadId}/intake`, {
        method: "PATCH", cookie, body: { ceremonyType, deceasedName: "Synthetic intake original", needs: "Synthetic audit needs original" },
        headers: { "idempotency-key": `${fixtures.runId}:proof:${scenario}`, "x-correlation-id": fixtures.runId },
      }), { params: Promise.resolve({ caseId: String(record.leadId) }) }));
    } finally { await control(false); }
    assert.equal(response.status, 200, JSON.stringify({ stage: "PRODUCTION_POLICY_INTAKE", trace }));
    const result = await response.json();
    assert.equal(result.stage, "QUOTING"); assert.equal(result.scenarioId, scenario);
    assert.equal(await db.caseDocumentRequirement.count({ where: { caseId: record.id } }), ruleCount);
    assert.equal(await db.caseEvent.count({ where: { caseId: record.id } }), 3);
    assert.equal(await db.task.count({ where: { caseId: record.id } }), 2);
    const events = await db.caseEvent.findMany({ where: { caseId: record.id }, select: { id: true } });
    assert.equal(await db.projectionReceipt.count({ where: { organizationId: actor.organizationId, sourceEventId: { in: events.map(event => event.id) } } }), 2);
    assert.equal(trace.proofReads, 1,
      "Nested materialization must reuse the transaction-local proof rather than reload it");
    assert.equal(trace.transactionMs.length, 1);
    assert.ok(trace.transactionMs[0] < Number(process.env.M3_INTAKE_LATENCY_BUDGET_MS ?? "4500"), JSON.stringify({ code: "PRODUCTION_POLICY_INTAKE_DEADLINE_MARGIN", trace }));
    console.log(JSON.stringify({ productionProofIntake: scenario, rules: ruleCount, transactionMs: Math.round(trace.transactionMs[0]), prismaOperations: trace.operations.length, binding: commandFingerprint(bundle) === JSON.parse(process.env.M3_PRODUCTION_POLICY_BINDINGS!)[actor.organizationId] }));
  }
}

async function verifyReviewerEpochConcurrency(bundle: M3ApprovedPolicyBundle, revokeToken: string) {
  const attestation = bundle.attestations.finance;
  const expected = { reviewerId: attestation.reviewer.id, reviewerName: attestation.reviewer.name,
    reviewerRole: attestation.reviewer.role, publicKeyPem: attestation.signature.publicKeyPem,
    keyFingerprint: attestation.signature.keyFingerprint };
  const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };
  const firstEntered = gate(), secondEntered = gate(), releaseReaders = gate();
  const readers = [firstEntered, secondEntered].map(entered => db.$transaction(async tx => {
    await requireActiveM3ReviewerCredential(tx, expected);
    entered.resolve();
    await releaseReaders.promise;
  }).then(() => ({ error: null }), (error: unknown) => ({ error })));
  try {
    await Promise.race([Promise.all([firstEntered.promise, secondEntered.promise]),
      Promise.race(readers).then(() => { throw new Error("Concurrent credential readers did not share locks"); })]);
  } finally {
    releaseReaders.resolve();
    for (const outcome of await Promise.all(readers)) assert.equal(outcome.error, null);
  }

  const readerEntered = gate(), releaseReader = gate(), writerAttempted = gate();
  let readerPid = 0, writerPid = 0;
  const reader = db.$transaction(async tx => {
    await requireActiveM3ReviewerCredential(tx, expected);
    [readerPid] = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`).map(row => row.pid);
    readerEntered.resolve(); await releaseReader.promise;
  }).then(() => ({ error: null }), (error: unknown) => ({ error }));
  const rollback = new Error("SYNTHETIC_REVOKER_ROLLBACK");
  let writerCompleted = false;
  let writer: Promise<{ error: unknown }> | undefined;
  try {
    await Promise.race([readerEntered.promise, reader.then(() => { throw new Error("Reader settled before barrier"); })]);
    writer = db.$transaction(async tx => {
      [writerPid] = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`).map(row => row.pid);
      const observed = new Proxy(tx, { get(target, property, receiver) {
        if (property !== "$executeRaw") return Reflect.get(target, property, receiver);
        return (...args: unknown[]) => {
          const sql = args[0];
          const text = Array.isArray(sql) ? sql.join("?") : "";
          if (text.includes("pg_advisory_xact_lock(")
            && args.slice(1).includes(`m3-reviewer-credential:${expected.keyFingerprint}`)) writerAttempted.resolve();
          return (target.$executeRaw as (...parameters: unknown[]) => Promise<unknown>).apply(target, args);
        };
      } }) as Prisma.TransactionClient;
      await revokeM3ReviewerCredential(observed, revokeToken, expected.keyFingerprint, "REVIEWER_OFFBOARDED");
      writerCompleted = true; throw rollback;
    }).then(() => ({ error: null }), (error: unknown) => ({ error }));
    await Promise.race([writerAttempted.promise, writer.then(() => { throw new Error("Revoker settled before advisory lock attempt"); })]);
    await assertPostgresLockWait(writerPid, readerPid);
    assert.equal(writerCompleted, false, "Revocation must wait for active authorization readers");
  } finally {
    releaseReader.resolve();
    assert.equal((await reader).error, null);
    if (writer) assert.equal((await writer).error, rollback);
  }

  const snapshotReady = gate(), revocationCommitted = gate();
  let attempts = 0, businessWrites = 0;
  const staleReader = runM3ReviewerCredentialTransaction(db, async tx => {
    attempts++;
    await tx.$queryRaw`SELECT version FROM "M3ReviewerCredentialEpoch" WHERE "keyFingerprint" = ${expected.keyFingerprint}`;
    snapshotReady.resolve(); await revocationCommitted.promise;
    await requireActiveM3ReviewerCredential(tx, expected);
    businessWrites++;
  }).then(() => ({ error: null }), (error: unknown) => ({ error }));
  try {
    await Promise.race([snapshotReady.promise, staleReader.then(() => { throw new Error("Reader settled before snapshot barrier"); })]);
    await runM3ReviewerCredentialTransaction(db, tx => revokeM3ReviewerCredential(tx, revokeToken, expected.keyFingerprint, "REVIEWER_OFFBOARDED"));
  } finally { revocationCommitted.resolve(); }
  const outcome = await staleReader;
  assert.equal((outcome.error as { status?: number })?.status, 403,
    `Stale snapshot must retry and reject revoked credential; code=${(outcome.error as { code?: string })?.code}`);
  assert.equal(attempts, 2);
  assert.equal(businessWrites, 0);
  await assert.rejects(db.$transaction(tx => requireActiveM3ReviewerCredential(tx, expected)), { status: 403 });
}

async function assertPostgresLockWait(waiter: number, blocker: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [state] = await db.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT ${blocker}::int = ANY(pg_blocking_pids(${waiter}::int))
        AND wait_event_type = 'Lock' AND wait_event = 'advisory' AS waiting
      FROM pg_stat_activity WHERE pid = ${waiter}
    `;
    if (state?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Expected exact PostgreSQL advisory-lock blocker was not observed");
}

async function verifyProofActivationLockOrder(bundle: M3ApprovedPolicyBundle) {
  const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };
  const entered = gate(), release = gate(), activationAttempted = gate();
  const queries: string[] = [];
  let activationCompleted = false;
  const guarded = db.$transaction(async tx => {
    const observed = new Proxy(tx, { get(target, property, receiver) {
      if (property !== "$queryRaw") return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        if (Array.isArray(args[0])) queries.push(args[0].join("?"));
        return (target.$queryRaw as (...parameters: unknown[]) => Promise<unknown>).apply(target, args);
      };
    } }) as Prisma.TransactionClient;
    await assertM3ProductionActivation(observed, bundle.organizationId);
    entered.resolve();
    await release.promise;
    // Contract signing takes this same organization lock after its wrapper proof.
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${bundle.organizationId} FOR SHARE`;
  });
  const guardedOutcome = guarded.then(() => ({ error: null }), (error: unknown) => ({ error }));
  let activationOutcome: Promise<{ error: unknown }> | undefined;
  try {
    await Promise.race([entered.promise, guardedOutcome.then(() => { throw new Error("Proof transaction settled before barrier"); })]);
    const activation = db.$transaction(async tx => {
      const observed = new Proxy(tx, { get(target, property, receiver) {
        if (property !== "$queryRaw") return Reflect.get(target, property, receiver);
        return async (...args: unknown[]) => {
          if (Array.isArray(args[0]) && args[0].join("?").includes('FROM "Organization"')) activationAttempted.resolve();
          return (target.$queryRaw as (...parameters: unknown[]) => Promise<unknown>).apply(target, args);
        };
      } }) as Prisma.TransactionClient;
      return applyM3ApprovedPolicyBundle(observed, bundle, humanSignoffs(bundle));
    });
    activationOutcome = activation.then(result => { activationCompleted = true; assert.equal(result.replayed, true); return { error: null }; }, (error: unknown) => ({ error }));
    await Promise.race([activationAttempted.promise, activationOutcome.then(() => { throw new Error("Activation settled before organization lock attempt"); })]);
    assert.equal(activationCompleted, false);
    assert.ok(queries[0].includes('FROM "Organization"'), "The organization must precede all reviewer advisory locks");
    release.resolve();
    assert.equal((await guardedOutcome).error, null);
    assert.equal((await activationOutcome).error, null);
  } finally {
    release.resolve();
    await guardedOutcome;
    await activationOutcome;
  }
}

async function verifyProofAuditForeignKeyLockOrder(
  bundle: M3ApprovedPolicyBundle,
  fixtures: ReturnType<typeof createFixtureContext>,
  actor: FixtureMember,
) {
  const record = await fixtures.makeCase(actor, "fk-lock-order");
  const meeting = await db.meeting.create({ data: { leadId: record.leadId, caseId: record.id, agentId: actor.agentId,
    organizationId: actor.organizationId, ownerMembershipId: actor.membershipId, idempotencyKey: `${fixtures.runId}:fk-meeting` } });
  const quote = await db.quote.create({ data: { meetingId: meeting.id, caseId: record.id, organizationId: actor.organizationId, ownerMembershipId: actor.membershipId, status: "DRAFT" } });
  const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };
  const updated = gate(), releaseAudit = gate(), publishAttempted = gate();
  let publishAttempts = 0;
  const review = db.$transaction(async tx => {
    // Isolate lock compatibility from a legitimate SERIALIZABLE row-version retry.
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
    updated.resolve();
    await releaseAudit.promise;
    // This real FK insertion takes KEY SHARE on Organization after holding Quote.
    await tx.operationalAuditEvent.create({ data: { organizationId: actor.organizationId, actorMembershipId: actor.membershipId,
      entityType: "quote", entityId: String(quote.id), action: "synthetic.quote_lock_regression",
      before: { status: "DRAFT" }, after: { status: "DRAFT" }, result: {},
      correlationId: fixtures.runId, idempotencyKey: `${fixtures.runId}:fk-review` } });
  });
  const reviewOutcome = review.then(() => ({ error: null }), (error: unknown) => ({ error }));
  let publishOutcome: Promise<{ error: unknown }> | undefined;
  try {
    await Promise.race([updated.promise, reviewOutcome.then(() => { throw new Error("Review settled before audit barrier"); })]);
    const publish = runM3ProductionTransaction(bundle.organizationId, async tx => {
      publishAttempts++;
      publishAttempted.resolve();
      await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
    });
    publishOutcome = publish.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await Promise.race([publishAttempted.promise, publishOutcome.then(() => { throw new Error("Publish settled before Quote lock attempt"); })]);
    releaseAudit.resolve();
    assert.equal((await reviewOutcome).error, null);
    assert.equal((await publishOutcome).error, null);
    assert.equal(publishAttempts, 1, "Deadlock retries must not mask an Organization/Quote FK inversion");
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: actor.organizationId, idempotencyKey: `${fixtures.runId}:fk-review` } }), 1);
  } finally {
    releaseAudit.resolve();
    await reviewOutcome;
    await publishOutcome;
  }
}

function baselinePolicyBundle(
  organizationId: string,
  approvedByUserId: number,
): M3ApprovedPolicyBundle {
  const releaseCandidate = {
    previewUrl: "https://td-agent-synthetic-review.vercel.app/",
    deploymentId: "dpl_M3SyntheticReviewerEvidence12345",
    deploymentSha: "a".repeat(40),
    implementationSha: "a".repeat(40),
    databaseFingerprint: "1".repeat(16),
  };
  const typeCodes = {
    identity: "M3_IT_IDENTITY_V1",
    death: "M3_IT_DEATH_RECORD_V1",
    cremation: "M3_IT_CREMATION_V1",
    burialPlot: "M3_IT_BURIAL_PLOT_V1",
    relationship: "M3_IT_RELATIONSHIP_V1",
  };
  return signedPolicyBundle({
    schemaVersion: 3,
    releaseCandidate,
    organizationId,
    approvedByUserId,
    approvedAt: "2026-08-11T00:00:00.000Z",
    effectiveFrom: "2026-08-11T00:00:00.000Z",
    documentTypes: [
      {
        code: typeCodes.identity,
        version: 1,
        name: "Synthetic identity evidence",
        description: null,
        allowedMimeTypes: ["application/pdf"],
        maxBytes: 1_000_000,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
      },
      {
        code: typeCodes.death,
        version: 1,
        name: "Synthetic death-record evidence",
        description: null,
        allowedMimeTypes: ["application/pdf"],
        maxBytes: 1_000_000,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
      },
      documentType(typeCodes.cremation, "Synthetic cremation evidence"),
      documentType(typeCodes.burialPlot, "Synthetic burial-plot evidence"),
      documentType(typeCodes.relationship, "Synthetic relationship evidence"),
    ],
    documentPolicies: [
      {
        scenario: "CREMATION_V1",
        version: ACTIVATION_POLICY_VERSION,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
        rules: [
          rule("identity-record", typeCodes.identity, "identity-match"),
          rule("death-record", typeCodes.death, "death-record-match"),
          rule("cremation-authorization", typeCodes.cremation, "scenario-evidence"),
        ],
      },
      {
        scenario: "FAMILY_PLOT_BURIAL_V1",
        version: ACTIVATION_POLICY_VERSION,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
        rules: [
          rule("identity-record", typeCodes.identity, "identity-match"),
          rule("death-record", typeCodes.death, "death-record-match"),
          rule("plot-entitlement", typeCodes.burialPlot, "plot-evidence"),
          rule("relationship-evidence", typeCodes.relationship, "relationship-match"),
        ],
      },
    ],
    signingPolicy: {
      version: "synthetic-legal-baseline",
      allowedEvidenceTypes: ["SYNTHETIC_ACK"],
      source: "Synthetic legal policy",
    },
    financialPolicy: {
      version: 1,
      correctionThresholdKopecks: 10_000,
      source: "Synthetic finance policy",
    },
  });
}

function humanAttestation(
  role: ReviewerRole,
  checklistIds: readonly string[],
  releaseCandidate: {
    previewUrl: string;
    deploymentId: string;
    deploymentSha: string;
    implementationSha: string;
    databaseFingerprint: string;
  },
  policyContentFingerprint: string,
) {
  const credential = REVIEWER_KEYS[role];
  const unsigned = {
    verdict: "PASS" as const,
    reviewer: {
      id: `synthetic-${role.toLowerCase()}-reviewer`,
      name: `Synthetic ${role} reviewer`,
      role,
      credentialReference: `platform-audit-key:${credential.keyFingerprint}`,
      experienceYears: role === "RITUAL_OPERATIONS_SME" ? 10 : null,
    },
    source: "Synthetic human verdict fixture",
    date: "2026-08-10T23:00:00.000Z",
    reviewedPreviewUrl: releaseCandidate.previewUrl,
    reviewedDeploymentId: releaseCandidate.deploymentId,
    reviewedDeploymentSha: releaseCandidate.deploymentSha,
    reviewedImplementationSha: releaseCandidate.implementationSha,
    reviewedDatabaseFingerprint: releaseCandidate.databaseFingerprint,
    reviewedPolicyContentFingerprint: policyContentFingerprint,
    checklistAnswers: checklistIds.map((id) => ({
      id,
      verdict: "PASS" as const,
      notes: "Synthetic checklist result",
    })),
    scenarioResults: {
      cremation: { verdict: "PASS" as const, notes: "Synthetic cremation result" },
      familyPlotBurial: { verdict: "PASS" as const, notes: "Synthetic burial result" },
    },
  };
  const draft = {
    ...unsigned,
    signature: {
      algorithm: "Ed25519" as const,
      keyFingerprint: credential.keyFingerprint,
      publicKeyPem: credential.publicKeyPem,
      value: "A".repeat(86),
    },
  };
  return {
    ...draft,
    signature: {
      ...draft.signature,
      value: sign(null, Buffer.from(m3AttestationSigningPayload(draft)), credential.privateKey).toString("base64url"),
    },
  };
}

function humanSignoffs(bundle: M3ApprovedPolicyBundle) {
  const gate = (packet: "finance.md" | "privacy.md" | "ritual-rules.md", attestation: typeof bundle.attestations.finance) => ({
    status: "PASS" as const,
    packet,
    attestation,
    attestationFingerprint: m3AttestationFingerprint(attestation),
  });
  return {
    schemaVersion: 2 as const,
    candidate: bundle.releaseCandidate,
    policyContentFingerprint: m3PolicyContentFingerprint(bundle),
    gates: {
      financeAccounting: gate("finance.md", bundle.attestations.finance),
      legalPrivacy: gate("privacy.md", bundle.attestations.legalPrivacy),
      ritualOperationsSme: gate("ritual-rules.md", bundle.attestations.ritualSme),
    },
  };
}

function policyContent(bundle: M3ApprovedPolicyBundle) {
  return Object.fromEntries(
    Object.entries(bundle).filter(([key]) => key !== "attestations"),
  ) as Omit<M3ApprovedPolicyBundle, "attestations">;
}

function signedPolicyBundle(content: ReturnType<typeof policyContent>): M3ApprovedPolicyBundle {
  const policyContentFingerprint = commandFingerprint(content);
  return parseM3ApprovedPolicyBundle({
    ...content,
    attestations: {
      finance: humanAttestation(
        "FINANCE_ACCOUNTING",
        M3_HUMAN_ATTESTATION_CHECKLISTS.finance,
        content.releaseCandidate,
        policyContentFingerprint,
      ),
      legalPrivacy: humanAttestation(
        "LEGAL_PRIVACY",
        M3_HUMAN_ATTESTATION_CHECKLISTS.legalPrivacy,
        content.releaseCandidate,
        policyContentFingerprint,
      ),
      ritualSme: humanAttestation(
        "RITUAL_OPERATIONS_SME",
        M3_HUMAN_ATTESTATION_CHECKLISTS.ritualSme,
        content.releaseCandidate,
        policyContentFingerprint,
      ),
    },
  });
}

async function registerReviewerCredentials(
  tx: Prisma.TransactionClient,
  bundle: M3ApprovedPolicyBundle,
  grants: Record<ReviewerRole, string>,
) {
  for (const attestation of Object.values(bundle.attestations)) {
    await registerM3ReviewerCredential(tx, grants[attestation.reviewer.role], {
      schemaVersion: 1,
      reviewerId: attestation.reviewer.id,
      reviewerName: attestation.reviewer.name,
      reviewerRole: attestation.reviewer.role,
      publicKeyPem: attestation.signature.publicKeyPem,
      verificationMethod: "VIDEO_CALL",
      verificationReference: `synthetic-verification:${attestation.reviewer.id}`,
      verifiedAt: "2026-08-13T08:00:00.000Z",
    });
  }
}

async function issueReviewerRegistrationGrants(
  bundle: M3ApprovedPolicyBundle,
  actor: { id: number; sessionVersion: number },
): Promise<Record<ReviewerRole, string>> {
  const grants = await Promise.all(Object.values(bundle.attestations).map(async (attestation) => {
    const grant = await issueReviewerAuthorityGrant(
      actor.id,
      actor.sessionVersion,
      "REGISTER",
      attestation.signature.keyFingerprint,
    );
    return [attestation.reviewer.role, grant.token] as const;
  }));
  return Object.fromEntries(grants) as Record<ReviewerRole, string>;
}

async function issueReviewerAuthorityGrant(
  actorUserId: number,
  sessionVersion: number,
  operation: "REGISTER" | "REVOKE",
  keyFingerprint: string,
) {
  const response = await requestReviewerAuthorityGrant(
    actorUserId,
    sessionVersion,
    operation,
    keyFingerprint,
  );
  assert.equal(response.status, 201);
  const body = await response.json() as {
    authorityGrant: string;
    expiresAt: string;
    auditEventId: string;
  };
  return { token: body.authorityGrant, expiresAt: body.expiresAt, auditEventId: body.auditEventId };
}

async function requestReviewerAuthorityGrant(
  actorUserId: number,
  sessionVersion: number,
  operation: "REGISTER" | "REVOKE",
  keyFingerprint: string,
  sessionToken?: string,
) {
  authorityRequestSequence += 1;
  const clientAddress = `2001:db8::${authorityRequestSequence.toString(16)}`;
  authorityRateLimitKeys.add(persistentRateLimitKey(AUTHORITY_RATE_LIMIT_BUCKET, clientAddress));
  const token = sessionToken ?? await reviewerAuthoritySession(actorUserId, sessionVersion);
  return grantM3ReviewerAuthority(makeRequest("/api/platform-admin/m3-reviewer-authority", {
    method: "POST",
    cookie: `${SESSION_COOKIE}=${token}`,
    headers: { "x-real-ip": clientAddress },
    body: { operation, keyFingerprint },
  }));
}

async function cleanupAuthorityRateLimitKeys() {
  const keyHashes = [...authorityRateLimitKeys];
  authorityRateLimitKeys.clear();
  if (keyHashes.length > 0) {
    await db.securityRateLimitBucket.deleteMany({ where: { keyHash: { in: keyHashes } } });
  }
}

async function reviewerAuthoritySession(userId: number, sessionVersion: number) {
  return signSession({
    version: 2,
    userId,
    sessionVersion,
    mfaVerified: true,
  });
}

function reviewerAuthoritySessionAt(userId: number, sessionVersion: number, issuedAt: number) {
  const payload = {
    userId,
    version: 2,
    sessionVersion,
    mfaVerified: true,
    iat: issuedAt,
    exp: issuedAt + (8 * 60 * 60),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = requireAppEncryptionKey();
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function documentType(code: string, name: string) {
  return {
    code,
    version: 1,
    name,
    description: null,
    allowedMimeTypes: ["application/pdf"] as Array<"application/pdf">,
    maxBytes: 1_000_000,
    source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
  };
}

function rule(stableKey: string, documentTypeCode: string, checklist: string) {
  return {
    stableKey,
    kind: "REQUIRED" as const,
    conditionKey: null,
    conditionExplanation: null,
    dueOffsetHours: null,
    ownerRole: "DOCUMENT_REVIEWER" as const,
    blockingStage: "EXECUTION" as const,
    acceptedDocumentTypeCodes: [documentTypeCode],
    reviewChecklist: [checklist],
    source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
  };
}
