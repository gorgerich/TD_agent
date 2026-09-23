import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../app/api/webhooks/order-complete/route";
import { createFixtureContext, db, dbTestsEnabled, makeRequest } from "./_setup";

test("legacy commission webhook authenticates before reads and refuses an unconfirmed margin", { skip: !dbTestsEnabled }, async () => {
  const previous = process.env.WEBHOOK_SECRET;
  const fixtures = createFixtureContext("legacy-order-webhook");
  const secret = "synthetic-integration-webhook-secret-32-chars";
  const request = (orderId: number, provided?: string) => makeRequest("/api/webhooks/order-complete", {
    method: "POST",
    body: { orderId },
    headers: provided === undefined ? {} : { "x-webhook-secret": provided },
  });
  try {
    for (const configured of [undefined, "", "short"]) {
      if (configured === undefined) delete process.env.WEBHOOK_SECRET;
      else process.env.WEBHOOK_SECRET = configured;
      assert.equal((await POST(request(1, secret))).status, 401);
    }
    process.env.WEBHOOK_SECRET = secret;
    assert.equal((await POST(request(1))).status, 401);
    assert.equal((await POST(request(1, "wrong"))).status, 401);

    const owner = await fixtures.makeAgent("owner");
    const order = await db.order.create({
      data: {
        userId: owner.userId,
        agentId: owner.agentId,
        publicId: `it-legacy-webhook-${fixtures.runId}`,
        status: "COMPLETED",
        serviceType: "funeral",
        totalAmount: 17_600_000,
        meta: "{}",
      },
    });
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => POST(makeRequest("/api/webhooks/order-complete", {
      method: "POST",
      body: { orderId: order.id },
      headers: { "x-webhook-secret": secret },
    }))));
    assert.deepEqual(outcomes.map((response) => response.status), [409, 409, 409, 409, 409]);
    assert.equal(await db.commission.count({ where: { orderId: order.id } }), 0);

    const historical = await db.commission.create({
      data: { orderId: order.id, agentId: owner.agentId, amount: 100, status: "ACCRUED" },
    });
    assert.equal((await POST(request(order.id, secret))).status, 409);
    assert.deepEqual(await db.commission.findUnique({ where: { id: historical.id } }), historical);

    const unassignedOrder = await db.order.create({
      data: {
        userId: owner.userId,
        publicId: `it-legacy-unassigned-${fixtures.runId}`,
        status: "COMPLETED",
        serviceType: "funeral",
        totalAmount: 17_600_000,
        meta: "{}",
      },
    });
    assert.equal((await POST(request(unassignedOrder.id, secret))).status, 200);
    const unassignedCommission = await db.commission.create({
      data: { orderId: unassignedOrder.id, agentId: owner.agentId, amount: 100, status: "ACCRUED" },
    });
    assert.equal((await POST(request(unassignedOrder.id, secret))).status, 409);
    assert.deepEqual(await db.commission.findUnique({ where: { id: unassignedCommission.id } }), unassignedCommission);
  } finally {
    if (previous === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = previous;
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});
