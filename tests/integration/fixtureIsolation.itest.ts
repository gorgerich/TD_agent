import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureContext, db, skip } from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

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
  }
});
