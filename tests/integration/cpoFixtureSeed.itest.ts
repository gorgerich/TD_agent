import assert from "node:assert/strict";
import { test } from "node:test";
import { seedCpoScenarios, type CpoSeedInput } from "../e2e/cpo-fixture-seed";
import { createFixtureContext, db, skip } from "./_setup";

const opts = { skip: skip ? "requires approved isolated local PostgreSQL" : false };
async function setup(tag: string) {
  const fixtures = createFixtureContext(`cpo-seed-${tag}`);
  try {
    const agent = await fixtures.makeAgent("owner"), candidate = await fixtures.makeAgent("foreign");
    const runId = fixtures.runId;
    await db.user.update({ where: { id: agent.userId }, data: { email: `m3-agent-${runId}@synthetic.invalid` } });
    await db.user.update({ where: { id: candidate.userId }, data: { email: `m3-foreign-${runId}@synthetic.invalid` } });
    for (const [scenario, count] of [["CREMATION_V1", 3], ["FAMILY_PLOT_BURIAL_V1", 4]] as const) {
      const policy = await db.documentRequirementPolicy.create({ data: {
        organizationId: agent.organizationId, scenario, version: 1, status: "APPROVED", source: "SYNTHETIC_SEED_REGRESSION",
        approvedByUserId: agent.userId, approvedAt: new Date(), effectiveFrom: new Date(Date.now() - 60_000),
        rules: { create: Array.from({ length: count }, (_, index) => ({ stableKey: `seed-${index}`, kind: "REQUIRED",
          ownerRole: "DOCUMENT_REVIEWER", blockingStage: "EXECUTION", dueOffsetHours: index,
          source: "SYNTHETIC_SEED_REGRESSION", conditionExplanation: `Synthetic ${index}`,
          acceptedDocumentTypeCodes: [`type-${index}`], acceptedDocumentTypeVersionIds: [`version-${index}`], reviewChecklist: [`check-${index}`],
        })) },
      } });
      fixtures.trackDocumentPolicy(policy.id);
    }
    const input: CpoSeedInput = { runId, organizationA: agent.organizationId, organizationB: candidate.organizationId,
      candidateMembershipId: candidate.membershipId, agentMembershipId: agent.membershipId,
      ownerEmail: `m3-cpo-owner-${runId}@synthetic.invalid`, passwordHash: "synthetic-test-not-an-authentication-credential",
      encryptedMfa: "synthetic-test-unused-mfa", encryptedDeceasedName: "synthetic-test-unused-pii",
      cases: { safe: `cpo-seed:${runId}:safe`, published: `cpo-seed:${runId}:published` } };
    return { fixtures, input, candidate };
  } catch (error) { await fixtures.cleanup(); throw error; }
}

async function snapshot() {
  return {
    users: await db.user.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    leads: await db.clientLead.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    cases: await db.case.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    requirements: await db.caseDocumentRequirement.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    meetings: await db.meeting.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
  };
}

test("CPO fixture uses six model actions, preserves exact policy copies and refuses replay", opts, async () => {
  const { fixtures, input } = await setup("success");
  try {
    const actions: string[] = [];
    await db.$transaction(tx => seedCpoScenarios(tx, input, async (label, operation) => { actions.push(label); return operation(); }));
    assert.deepEqual(actions, ["preflight", "owner", "leads", "cases", "requirements", "meeting"]);
    const owner = await db.user.findUniqueOrThrow({ where: { email: input.ownerEmail } }); fixtures.trackUser(owner.id);
    assert.equal(owner.platformRole, "SUPER_ADMIN");
    assert.equal(await db.agent.count({ where: { userId: owner.id } }), 0);
    assert.equal(await db.membership.count({ where: { userId: owner.id } }), 0);
    const cases = await db.case.findMany({ where: { id: { in: Object.values(input.cases) } }, include: { lead: true, documentRequirements: { include: { rule: true } }, meetings: true } });
    assert.equal(cases.length, 2);
    for (const record of cases) {
      assert.equal(record.tenantId, input.organizationA); assert.equal(record.stage, "QUOTING");
      assert.equal(record.scenarioId, "CREMATION_V1"); assert.equal(record.lead.source, "synthetic-cpo-repair");
      assert.equal(record.documentRequirements.length, 3);
      for (const item of record.documentRequirements) {
        assert.equal(item.satisfactionStatus, "NOT_SATISFIED"); assert.equal(item.sourceRule, item.rule.source);
        assert.equal(item.conditionExplanation, item.rule.conditionExplanation); assert.ok(item.dueAt);
        for (const field of ["stableKey", "kind", "ownerRole", "blockingStage", "acceptedDocumentTypeCodes", "acceptedDocumentTypeVersionIds", "reviewChecklist"] as const) assert.deepEqual(item[field], item.rule[field]);
      }
      assert.equal(record.meetings.length, record.id === input.cases.published ? 1 : 0);
    }
    const before = await snapshot();
    await assert.rejects(db.$transaction(tx => seedCpoScenarios(tx, input)), /Fixture already present/);
    assert.deepEqual(await snapshot(), before);
  } finally { await fixtures.cleanup(); await fixtures.assertNoResidue(); }
});

test("late CPO meeting failure rolls back owner, both cases, leads and six requirements", opts, async () => {
  const { fixtures, input } = await setup("rollback");
  try {
    const before = await snapshot();
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_cpo_fixture_meeting() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_CPO_FIXTURE_ROLLBACK'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_cpo_fixture_meeting BEFORE INSERT ON "Meeting" FOR EACH ROW EXECUTE FUNCTION reject_cpo_fixture_meeting()`);
    const actions: string[] = [];
    let callbackCompleted = false, commitAcknowledged = false;
    await assert.rejects((async () => {
      await db.$transaction(async tx => {
        await seedCpoScenarios(tx, input, async (label, operation) => { actions.push(label); return operation(); });
        callbackCompleted = true;
      });
      commitAcknowledged = true;
    })(), (error: unknown) => error instanceof Error && error.message.includes("TEST_CPO_FIXTURE_ROLLBACK"));
    assert.deepEqual(actions, ["preflight", "owner", "leads", "cases", "requirements", "meeting"]);
    assert.equal(callbackCompleted, false); assert.equal(commitAcknowledged, false);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS reject_cpo_fixture_meeting ON "Meeting"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS reject_cpo_fixture_meeting()`);
    await fixtures.cleanup(); await fixtures.assertNoResidue();
  }
});

test("CPO fixture rejects suspended candidate and concurrent duplicate seed has one atomic winner", opts, async () => {
  const { fixtures, input, candidate } = await setup("duplicate");
  try {
    await db.membership.update({ where: { id: candidate.membershipId }, data: { status: "SUSPENDED" } });
    const before = await snapshot();
    await assert.rejects(db.$transaction(tx => seedCpoScenarios(tx, input)), /Exact untouched M3 foreign AGENT/);
    assert.deepEqual(await snapshot(), before);
    await db.membership.update({ where: { id: candidate.membershipId }, data: { status: "ACTIVE" } });
    const results = await Promise.allSettled([db.$transaction(tx => seedCpoScenarios(tx, input)), db.$transaction(tx => seedCpoScenarios(tx, input))]);
    assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
    const owner = await db.user.findUniqueOrThrow({ where: { email: input.ownerEmail } }); fixtures.trackUser(owner.id);
    assert.equal(await db.case.count({ where: { id: { in: Object.values(input.cases) } } }), 2);
    assert.equal(await db.caseDocumentRequirement.count({ where: { caseId: { in: Object.values(input.cases) } } }), 6);
    assert.equal(await db.meeting.count({ where: { caseId: { in: Object.values(input.cases) } } }), 1);
  } finally { await fixtures.cleanup(); await fixtures.assertNoResidue(); }
});
