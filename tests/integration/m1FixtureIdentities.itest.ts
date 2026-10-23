import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import { db, skip } from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

function fixtureRunner() {
  assert.ok(!skip);
  const runId = `batch-${randomBytes(8).toString("hex")}`;
  const url = process.env.TEST_DATABASE_URL!;
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url,
    EXPECTED_DATABASE_FINGERPRINT: inspectDirectMigrationUrl(url).fingerprint,
    M1_UAT_FIXTURE: "1", M1_UAT_RUN_ID: runId, M1_UAT_PASSWORD: `${randomBytes(36).toString("hex")}!Aa9` };
  return {
    organizationId: `m1-uat:${runId}`,
    emails: ["agent", "assigned", "manager"].map(role => `m1-${role}-${runId}@synthetic.invalid`),
    run(command: string) {
      return spawnSync(process.execPath, ["--import", "tsx", "tests/e2e/m1-fixture.ts", command],
        { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    },
  };
}

test("M1 identity seed batches four model actions and preserves both scenario fixtures", opts, async () => {
  const fixture = fixtureRunner();
  try {
    const result = fixture.run("provision");
    assert.equal(result.status, 0, "M1 fixture provision must succeed without extending its transaction deadline");
    const metrics = JSON.parse(result.stderr.trim());
    assert.equal(metrics.identityCommitAcknowledged, true);
    assert.equal(metrics.identityCallbackCompleted, true);
    assert.deepEqual(metrics.identityActions.map((row: { model: string; action: string }) => [row.model, row.action]), [
      ["Organization", "create"], ["User", "createManyAndReturn"], ["Agent", "createManyAndReturn"], ["Membership", "createManyAndReturn"],
    ]);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.reconciliation, 0);
    assert.deepEqual(output.pilots.map((row: { key: string }) => row.key), ["cremation", "family"]);
    const members = await db.membership.findMany({ where: { organizationId: fixture.organizationId },
      include: { user: { select: { email: true } }, agent: { select: { userId: true } } } });
    assert.equal(members.length, 3);
    assert.deepEqual(members.map(row => row.role).sort(), ["AGENT", "AGENT", "MANAGER"]);
    assert.ok(members.every(row => row.agent?.userId === row.userId && row.user.email?.endsWith("@synthetic.invalid")));
  } finally {
    assert.equal(fixture.run("cleanup").status, 0, "M1 fixture cleanup must succeed");
    assert.equal(await db.organization.count({ where: { id: fixture.organizationId } }), 0);
  }
});

test("failure in the membership batch rolls back the organization, users and agents", opts, async () => {
  const fixture = fixtureRunner();
  const baseline = {
    users: await db.user.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    agents: await db.agent.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    memberships: await db.membership.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
  };
  // This file runs only in the canonical runner's own local disposable schema.
  await db.$executeRawUnsafe(`CREATE FUNCTION reject_m1_identity_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_IDENTITY_BATCH_ROLLBACK'; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_m1_identity_batch BEFORE INSERT ON "Membership" FOR EACH ROW EXECUTE FUNCTION reject_m1_identity_batch()`);
    const result = fixture.run("provision");
    assert.notEqual(result.status, 0);
    const failure = JSON.parse(result.stderr.trim());
    assert.equal(failure.phase, "IDENTITY_TRANSACTION");
    assert.equal(failure.identityCallbackCompleted, false);
    assert.equal(failure.identityCommitAcknowledged, false);
    assert.deepEqual(failure.identityActions.map((row: { model: string }) => row.model), ["Organization", "User", "Agent", "Membership"]);
    assert.ok(!result.stderr.includes("TEST_IDENTITY_BATCH_ROLLBACK"), "Raw database failure must not enter fixture logs");
    assert.equal(await db.organization.count({ where: { id: fixture.organizationId } }), 0);
    assert.equal(await db.user.count({ where: { email: { in: fixture.emails } } }), 0);
    assert.deepEqual(await db.user.findMany({ select: { id: true }, orderBy: { id: "asc" } }), baseline.users);
    assert.deepEqual(await db.agent.findMany({ select: { id: true }, orderBy: { id: "asc" } }), baseline.agents);
    assert.deepEqual(await db.membership.findMany({ select: { id: true }, orderBy: { id: "asc" } }), baseline.memberships);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS reject_m1_identity_batch ON "Membership"`);
    await db.$executeRawUnsafe(`DROP FUNCTION reject_m1_identity_batch()`);
    assert.equal(fixture.run("cleanup").status, 0);
  }
});
