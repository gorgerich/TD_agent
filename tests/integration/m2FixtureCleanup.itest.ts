import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import { assertOnlyRecognisedSyntheticData, censusOfTarget, m2UatNamespace, m3UatNamespace } from "../e2e/uatFixtureGuard";
import { installM3IntegrationBaseline, removeM3IntegrationBaseline } from "./_m3Baseline";
import { createFixtureContext, db, skip } from "./_setup";

const opts = { skip: skip ? "requires approved isolated local PostgreSQL" : false };

test("CI cleans owned M2 onboarding and recovery before the unchanged strict CPO census", opts, async () => {
  const workflow = readFileSync(".github/workflows/quality.yml", "utf8");
  const commands = ["m2-fixture", "cpo-repair-fixture", "m3-fixture"].map(name => `npx tsx tests/e2e/${name}.ts cleanup`);
  const positions = commands.map(command => workflow.indexOf(command));
  assert.ok(positions.every(position => position >= 0));
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2], "M2 cleanup must precede CPO census; CPO cleanup must still precede M3");

  const fixtures = createFixtureContext("m2-cleanup-order");
  const runId = `cleanup-${randomBytes(8).toString("hex")}`;
  const url = process.env.TEST_DATABASE_URL!;
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url,
    EXPECTED_DATABASE_FINGERPRINT: inspectDirectMigrationUrl(url).fingerprint,
    M2_UAT_FIXTURE: "1", M2_UAT_RUN_ID: runId, M2_UAT_PASSWORD: `${randomBytes(36).toString("hex")}!Aa9`,
    M2_UAT_ACTIVATION_TOKEN: randomBytes(32).toString("base64url"),
    M2_UAT_RECOVERY_TOKEN: randomBytes(32).toString("base64url"), M2_UAT_MFA_SECRET: "A".repeat(32) };
  function run(command: string) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "tests/e2e/m2-fixture.ts", command],
      { env, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `M2 fixture ${command} must succeed`);
  }
  const m3 = m3UatNamespace(runId);
  const ownerEmail = `m3-cpo-owner-${runId}@synthetic.invalid`;
  const allowed = [m2UatNamespace(runId), m3, { label: "CPO extension", organizationIds: [], userEmails: [ownerEmail] }];
  const assertCensus = async () => assertOnlyRecognisedSyntheticData(await censusOfTarget(db), allowed, "CPO repair extension");
  const expiresAt = new Date(Date.now() + 60_000);
  const tokenHash = () => randomBytes(32).toString("hex");
  async function organization(slug: string) {
    const row = await db.organization.create({ data: { slug, name: "Synthetic cleanup regression" } });
    fixtures.trackCreatedOrganization(row.id);
    return row;
  }
  async function user(email: string) {
    const row = await db.user.create({ data: { email } });
    fixtures.trackUser(row.id);
    return row;
  }

  // The canonical runner owns this schema; remove only its known baseline actor
  // so the real, unfiltered browser census can be exercised without exceptions.
  await removeM3IntegrationBaseline();
  try {
    run("provision");
    const platform = await db.user.findUniqueOrThrow({ where: { email: `m2-platform-${runId}@synthetic.invalid` } });
    const sibling = await db.organization.create({ data: { id: m3.organizationIds[0], slug: `m3-cleanup-${runId}`, name: "Synthetic M3 sibling" } });
    fixtures.trackCreatedOrganization(sibling.id);
    const reviewer = await user(m3.userEmails[2]);
    const siblingMember = await db.membership.create({ data: { organizationId: sibling.id, userId: reviewer.id, role: "DOCUMENT_REVIEWER" } });
    const owner = await user(ownerEmail);
    const siblingAudit = await db.platformAuditEvent.create({ data: {
      actorUserId: owner.id, action: "ORGANIZATION_FIRST_ADMIN_ASSIGNED", targetType: "organization", targetId: sibling.id, metadata: {},
    } });
    const siblingBefore = {
      organization: sibling, user: reviewer, membership: siblingMember, owner, audit: siblingAudit,
    };
    await assertCensus();

    const onboarded = await organization(`onboarding-${runId}`);
    const admin = await user(`onboarding-admin-${runId}@synthetic.invalid`);
    const finance = await user(`onboarding-finance-${runId}@synthetic.invalid`);
    const adminMember = await db.membership.create({ data: { organizationId: onboarded.id, userId: admin.id, role: "ADMIN" } });
    const financeMember = await db.membership.create({ data: { organizationId: onboarded.id, userId: finance.id, role: "FINANCE" } });
    const platformInvite = await db.platformOrganizationInvite.create({ data: {
      organizationId: onboarded.id, emailNormalized: admin.email!, createdByUserId: platform.id,
      tokenHash: tokenHash(), expiresAt, acceptedAt: new Date(),
    } });
    const invitation = await db.organizationInvite.create({ data: {
      organizationId: onboarded.id, emailNormalized: finance.email!, role: "FINANCE", createdByMembershipId: adminMember.id,
      tokenHash: tokenHash(), expiresAt, acceptedAt: new Date(),
    } });
    const recovery = await db.staffAccountRecovery.create({ data: {
      organizationId: onboarded.id, userId: finance.id, issuedByUserId: platform.id, membershipId: financeMember.id,
      issuedSessionVersion: finance.sessionVersion, issuedRole: "FINANCE", resetMfa: true,
      tokenHash: tokenHash(), mfaSecretEncrypted: "synthetic-unused-recovery-seed", expiresAt,
    } });
    const memberAudit = await db.platformAuditEvent.create({ data: {
      actorUserId: finance.id, action: "PLATFORM_MFA_ENROLLED", targetType: "user", targetId: String(finance.id), metadata: {},
    } });
    await assert.rejects(assertCensus, /outside the mission's synthetic namespaces/);

    run("cleanup");
    assert.equal(await db.organization.count({ where: { id: onboarded.id } }), 0);
    assert.equal(await db.user.count({ where: { id: { in: [admin.id, finance.id, platform.id] } } }), 0);
    assert.equal(await db.membership.count({ where: { id: { in: [adminMember.id, financeMember.id] } } }), 0);
    assert.equal(await db.platformOrganizationInvite.count({ where: { id: platformInvite.id } }), 0);
    assert.equal(await db.organizationInvite.count({ where: { id: invitation.id } }), 0);
    assert.equal(await db.staffAccountRecovery.count({ where: { id: recovery.id } }), 0);
    assert.equal(await db.platformAuditEvent.count({ where: { id: memberAudit.id } }), 0);
    assert.deepEqual({
      organization: await db.organization.findUniqueOrThrow({ where: { id: sibling.id } }),
      user: await db.user.findUniqueOrThrow({ where: { id: reviewer.id } }),
      membership: await db.membership.findUniqueOrThrow({ where: { id: siblingMember.id } }),
      owner: await db.user.findUniqueOrThrow({ where: { id: owner.id } }),
      audit: await db.platformAuditEvent.findUniqueOrThrow({ where: { id: siblingAudit.id } }),
    }, siblingBefore, "M2 cleanup must not mutate sibling M3/CPO identities or audit");
    await assertCensus();

    // An identical slug without the exact M2 creator is foreign, not cleanup-owned.
    const foreign = await organization(`onboarding-${runId}`);
    const foreignInvite = await db.platformOrganizationInvite.create({ data: {
      organizationId: foreign.id, emailNormalized: owner.email!, createdByUserId: owner.id, tokenHash: tokenHash(), expiresAt,
    } });
    run("cleanup");
    assert.deepEqual(await db.organization.findUniqueOrThrow({ where: { id: foreign.id } }), foreign);
    assert.deepEqual(await db.platformOrganizationInvite.findUniqueOrThrow({ where: { id: foreignInvite.id } }), foreignInvite);
    await assert.rejects(assertCensus, /outside the mission's synthetic namespaces/);
  } finally {
    try { run("cleanup"); } finally {
      try { await fixtures.cleanup(); await fixtures.assertNoResidue(); } finally { await installM3IntegrationBaseline(); }
    }
  }
});
