import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { skip, db, makeAgent, sessionCookieHeader, makeRequest, cleanup } from "./_setup";
import { POST as leadsPost, GET as leadsGet } from "../../app/api/agent/leads/route";
import { POST as meetingsPost } from "../../app/api/agent/meetings/route";
import { POST as quotePost } from "../../app/api/agent/meeting/[meetingId]/quote/route";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

before(async () => {
  if (!skip) await cleanup();
});
after(async () => {
  if (!skip) await cleanup();
});

test("leads: context encrypted at rest, decrypted on read", opts, async () => {
  const a = await makeAgent("enc");
  const cookie = await sessionCookieHeader(a.userId, a.agentId);

  const res = await leadsPost(
    makeRequest("/api/agent/leads", {
      method: "POST",
      cookie,
      body: { name: "Иван", phone: "+79161234567", source: "agent", context: "секретные ПДн" },
    }),
  );
  assert.equal(res.status, 201);
  const created = (await res.json()) as { id: number; context: string };
  assert.equal(created.context, "секретные ПДн"); // API returns decrypted

  const raw = await db.clientLead.findUnique({ where: { id: created.id } });
  assert.ok(raw!.context!.startsWith("enc1:")); // stored encrypted

  const listRes = await leadsGet(makeRequest("/api/agent/leads", { cookie }));
  const list = (await listRes.json()) as Array<{ id: number; context: string }>;
  assert.equal(list.find((l) => l.id === created.id)?.context, "секретные ПДн");
});

test("meetings: cannot attach meeting to another agent's lead (IDOR → 404)", opts, async () => {
  const a = await makeAgent("owner");
  const b = await makeAgent("attacker");

  const leadRes = await leadsPost(
    makeRequest("/api/agent/leads", {
      method: "POST",
      cookie: await sessionCookieHeader(a.userId, a.agentId),
      body: { name: "Лид A", phone: "+79160000001", source: "agent" },
    }),
  );
  const lead = (await leadRes.json()) as { id: number };

  const res = await meetingsPost(
    makeRequest("/api/agent/meetings", {
      method: "POST",
      cookie: await sessionCookieHeader(b.userId, b.agentId),
      body: { leadId: lead.id },
    }),
  );
  assert.equal(res.status, 404); // assertLeadOwned blocks cross-agent
});

test("quote: save requires auth (401) and ownership (404)", opts, async () => {
  const a = await makeAgent("qowner");
  const b = await makeAgent("qother");

  // agent A: lead → meeting
  const leadRes = await leadsPost(
    makeRequest("/api/agent/leads", {
      method: "POST",
      cookie: await sessionCookieHeader(a.userId, a.agentId),
      body: { name: "Лид Q", phone: "+79160000002", source: "agent" },
    }),
  );
  const lead = (await leadRes.json()) as { id: number };
  const mRes = await meetingsPost(
    makeRequest("/api/agent/meetings", {
      method: "POST",
      cookie: await sessionCookieHeader(a.userId, a.agentId),
      body: { leadId: lead.id },
    }),
  );
  const meeting = (await mRes.json()) as { id: number };
  const params = { params: Promise.resolve({ meetingId: String(meeting.id) }) };

  // no cookie → 401
  const noAuth = await quotePost(makeRequest(`/api/agent/meeting/${meeting.id}/quote`, { method: "POST", body: { payload: {}, total: 1000 } }), params);
  assert.equal(noAuth.status, 401);

  // wrong agent → 404 (assertMeetingOwned)
  const wrong = await quotePost(
    makeRequest(`/api/agent/meeting/${meeting.id}/quote`, {
      method: "POST",
      cookie: await sessionCookieHeader(b.userId, b.agentId),
      body: { payload: {}, total: 1000 },
    }),
    params,
  );
  assert.equal(wrong.status, 404);

  // owner → 200
  const ok = await quotePost(
    makeRequest(`/api/agent/meeting/${meeting.id}/quote`, {
      method: "POST",
      cookie: await sessionCookieHeader(a.userId, a.agentId),
      body: { payload: { x: 1 }, total: 2500 },
    }),
    params,
  );
  assert.equal(ok.status, 200);
});
