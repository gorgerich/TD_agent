import assert from "node:assert/strict";
import { test } from "node:test";
import { DELETE, PATCH } from "../../app/api/agent/catalog/[id]/route";
import { GET, POST } from "../../app/api/agent/catalog/route";
import { createFixtureContext, db, makeRequest, sessionCookieHeader, skip } from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

test("M2 catalog revisions are tenant-scoped, immutable and idempotent", opts, async () => {
  const fixtures = createFixtureContext("m2-commercial-catalog");
  try {
    const owner = await fixtures.makeAgent("owner");
    const manager = await fixtures.makeMember("manager", {
      organizationId: owner.organizationId,
      role: "MANAGER",
    });
    const foreign = await fixtures.makeAgent("foreign");
    const ownerCookie = await sessionCookieHeader(owner.userId, owner.agentId);
    const managerCookie = await sessionCookieHeader(manager.userId, manager.agentId);
    const foreignCookie = await sessionCookieHeader(foreign.userId, foreign.agentId);
    const requestKey = `catalog:${fixtures.runId}:create`;
    const body = {
      name: "Синтетическая урна",
      category: "Урны",
      clientPrice: 12_500,
      costPrice: null,
      description: "Только integration fixture",
      imageData: "data:image/png;base64,AA==",
    };

    const created = await POST(makeRequest("/api/agent/catalog", {
      method: "POST",
      cookie: ownerCookie,
      body,
      headers: { "idempotency-key": requestKey, "x-correlation-id": requestKey },
    }));
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { item: { id: string } };

    const replay = await POST(makeRequest("/api/agent/catalog", {
      method: "POST",
      cookie: ownerCookie,
      body,
      headers: { "idempotency-key": requestKey, "x-correlation-id": requestKey },
    }));
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).item.id, createdBody.item.id);
    assert.equal(await db.agentCatalogItem.count({ where: { id: createdBody.item.id } }), 1);
    assert.equal(await db.catalogItemRevision.count({ where: { catalogItemId: createdBody.item.id } }), 1);

    const managerList = await GET(makeRequest("/api/agent/catalog", { cookie: managerCookie }));
    assert.equal(managerList.status, 200);
    assert.equal((await managerList.json()).items.some((item: { id: string }) => item.id === createdBody.item.id), true);
    const foreignList = await GET(makeRequest("/api/agent/catalog", { cookie: foreignCookie }));
    assert.equal(foreignList.status, 200);
    assert.equal((await foreignList.json()).items.some((item: { id: string }) => item.id === createdBody.item.id), false);

    const priceParams = { params: Promise.resolve({ id: createdBody.item.id }) };
    const requestPriceKey = `catalog:${fixtures.runId}:request-price`;
    const requestPrice = () => PATCH(
      makeRequest(`/api/agent/catalog/${createdBody.item.id}`, {
        method: "PATCH",
        cookie: ownerCookie,
        body: { action: "REQUEST_PRICE" },
        headers: { "idempotency-key": requestPriceKey, "x-correlation-id": requestPriceKey },
      }),
      priceParams,
    );
    assert.equal((await requestPrice()).status, 200);
    assert.equal((await requestPrice()).status, 200);
    assert.equal((await db.agentCatalogItem.findUniqueOrThrow({
      where: { id: createdBody.item.id },
      select: { priceState: true, currentVersion: true },
    })).priceState, "REQUESTED");
    assert.equal(await db.catalogItemRevision.count({ where: { catalogItemId: createdBody.item.id } }), 2);

    const foreignConfirm = await PATCH(
      makeRequest(`/api/agent/catalog/${createdBody.item.id}`, {
        method: "PATCH",
        cookie: foreignCookie,
        body: { action: "CONFIRM_PRICE", clientPrice: 13_000 },
        headers: {
          "idempotency-key": `catalog:${fixtures.runId}:foreign-confirm`,
          "x-correlation-id": `catalog:${fixtures.runId}:foreign-confirm`,
        },
      }),
      priceParams,
    );
    assert.equal(foreignConfirm.status, 404);

    const confirmPriceKey = `catalog:${fixtures.runId}:confirm-price`;
    const confirmPrice = () => PATCH(
      makeRequest(`/api/agent/catalog/${createdBody.item.id}`, {
        method: "PATCH",
        cookie: ownerCookie,
        body: { action: "CONFIRM_PRICE", clientPrice: 13_000 },
        headers: { "idempotency-key": confirmPriceKey, "x-correlation-id": confirmPriceKey },
      }),
      priceParams,
    );
    assert.equal((await confirmPrice()).status, 200);
    assert.equal((await confirmPrice()).status, 200);
    const confirmedRevision = await db.catalogItemRevision.findFirstOrThrow({
      where: { catalogItemId: createdBody.item.id },
      orderBy: { version: "desc" },
    });
    assert.equal(confirmedRevision.version, 3);
    assert.equal(confirmedRevision.priceState, "KNOWN");
    assert.equal(confirmedRevision.clientUnitPrice, 1_300_000);
    assert.equal(confirmedRevision.costState, "UNKNOWN");
    assert.equal(confirmedRevision.unitCost, null);

    const deleteKey = `catalog:${fixtures.runId}:discontinue`;
    const discontinue = () => DELETE(
      makeRequest(`/api/agent/catalog/${createdBody.item.id}`, {
        method: "DELETE",
        cookie: ownerCookie,
        headers: { "idempotency-key": deleteKey, "x-correlation-id": deleteKey },
      }),
      { params: Promise.resolve({ id: createdBody.item.id }) },
    );
    assert.equal((await discontinue()).status, 200);
    assert.equal((await discontinue()).status, 200);
    assert.equal(await db.catalogItemRevision.count({ where: { catalogItemId: createdBody.item.id } }), 4);
    assert.equal((await db.agentCatalogItem.findUniqueOrThrow({
      where: { id: createdBody.item.id },
      select: { availability: true, currentVersion: true },
    })).currentVersion, 4);
    const firstRevision = await db.catalogItemRevision.findFirstOrThrow({
      where: { catalogItemId: createdBody.item.id },
      orderBy: { version: "asc" },
    });
    await assert.rejects(
      db.catalogItemRevision.update({
        where: { id: firstRevision.id },
        data: { clientUnitPrice: 1 },
      }),
      /append-only/,
    );
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});
