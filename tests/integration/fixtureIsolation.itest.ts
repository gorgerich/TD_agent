import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureContext, db, skip } from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

/**
 * Every operational command runs at SERIALIZABLE. Postgres tracks that with SSI predicate
 * locks, and `max_pred_locks_per_page` (default 2) is the point at which per-tuple locks
 * on one page collapse into a single page-level lock. Once that happens, two transactions
 * that touch different tenants' rows conflict purely because those rows share a heap or
 * index page, and the command fails with P2034 even though nothing actually raced.
 *
 * Escalation never breaks serializability — it trades precision for memory — but the false
 * positives it produces are indistinguishable from real conflicts, so a low setting turns
 * a correct system into an unreliable one under concurrency. Assert the environment here
 * so a misconfigured database fails loudly and once, instead of surfacing as an
 * intermittent 409 somewhere else in the suite.
 */
const MIN_PRED_LOCKS_PER_PAGE = 64;

test("database is configured so SSI predicate locks do not escalate to page granularity", opts, async () => {
  const [{ setting }] = await db.$queryRaw<{ setting: string }[]>`
    SELECT setting FROM pg_settings WHERE name = 'max_pred_locks_per_page'
  `;
  assert.ok(
    Number(setting) >= MIN_PRED_LOCKS_PER_PAGE,
    `max_pred_locks_per_page is ${setting}, expected at least ${MIN_PRED_LOCKS_PER_PAGE}. `
      + "Run: ALTER SYSTEM SET max_pred_locks_per_page = 64; SELECT pg_reload_conf();",
  );
});

test("integration fixtures clean only their own rows under parallel activity", opts, async () => {
  const left = createFixtureContext("isolation-left");
  const right = createFixtureContext("isolation-right");

  try {
    const [leftAgent, rightAgent] = await Promise.all([
      left.makeAgent("owner"),
      right.makeAgent("owner"),
    ]);
    await Promise.all([
      db.clientLead.create({
        data: { agentId: leftAgent.agentId, name: "Left fixture", phone: "+70000000101", source: "test" },
      }),
      db.clientLead.create({
        data: { agentId: rightAgent.agentId, name: "Right fixture", phone: "+70000000102", source: "test" },
      }),
    ]);

    await Promise.all([
      left.cleanup(),
      db.clientLead.create({
        data: { agentId: rightAgent.agentId, name: "Right concurrent fixture", phone: "+70000000103", source: "test" },
      }),
    ]);

    assert.equal(await db.agent.count({ where: { id: leftAgent.agentId } }), 0);
    assert.equal(await db.user.count({ where: { id: leftAgent.userId } }), 0);
    assert.equal(await db.agent.count({ where: { id: rightAgent.agentId } }), 1);
    assert.equal(await db.user.count({ where: { id: rightAgent.userId } }), 1);
    assert.equal(await db.clientLead.count({ where: { agentId: rightAgent.agentId } }), 2);
  } finally {
    await Promise.all([left.cleanup(), right.cleanup()]);
    await Promise.all([left.assertNoResidue(), right.assertNoResidue()]);
  }
});
