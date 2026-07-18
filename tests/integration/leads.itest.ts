import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { skip, db, createFixtureContext, sessionCookieHeader, makeRequest } from "./_setup";
import { POST as leadsPost, GET as leadsGet } from "../../app/api/agent/leads/route";
import { POST as meetingsPost } from "../../app/api/agent/meetings/route";
import { POST as quotePost } from "../../app/api/agent/meeting/[meetingId]/quote/route";
import { POST as documentPost } from "../../app/api/agent/cases/[caseId]/documents/route";
import { DELETE as documentDelete } from "../../app/api/agent/cases/[caseId]/documents/[docId]/route";
import { setDocumentStorageForTests } from "../../lib/documentStorage";
import { InMemoryTestStorage } from "../fixtures/testStorage";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };
const fixtures = createFixtureContext("leads");

before(async () => {
  if (!skip) await fixtures.cleanup();
});
after(async () => {
  if (!skip) await fixtures.cleanup();
});

test("leads: context encrypted at rest, decrypted on read", opts, async () => {
  const a = await fixtures.makeAgent("enc");
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
  const a = await fixtures.makeAgent("owner");
  const b = await fixtures.makeAgent("attacker");

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
  const a = await fixtures.makeAgent("qowner");
  const b = await fixtures.makeAgent("qother");

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

test("documents: upload/delete use isolated test storage", opts, async () => {
  const a = await fixtures.makeAgent("docs");
  const cookie = await sessionCookieHeader(a.userId, a.agentId);
  const leadRes = await leadsPost(
    makeRequest("/api/agent/leads", {
      method: "POST",
      cookie,
      body: { name: "Документы", phone: "+79160000003", source: "agent" },
    }),
  );
  const lead = (await leadRes.json()) as { id: number };
  const storage = new InMemoryTestStorage();
  setDocumentStorageForTests(storage);

  try {
    const form = new FormData();
    form.set("category", "Прочее");
    form.set("file", new File(["fixture"], "fixture.pdf", { type: "application/pdf" }));
    const upload = await documentPost(
      new NextRequest(`http://localhost/api/agent/cases/${lead.id}/documents`, {
        method: "POST",
        headers: { cookie },
        body: form,
      }),
      { params: Promise.resolve({ caseId: String(lead.id) }) },
    );
    assert.equal(upload.status, 200);
    const created = (await upload.json()) as { document: { id: number; url: string } };
    assert.match(created.document.url, /^memory:\/\//);
    assert.equal(storage.size, 1);

    const removed = await documentDelete(
      makeRequest(`/api/agent/cases/${lead.id}/documents/${created.document.id}`, { method: "DELETE", cookie }),
      { params: Promise.resolve({ caseId: String(lead.id), docId: String(created.document.id) }) },
    );
    assert.equal(removed.status, 200);
    assert.equal(storage.size, 0);
  } finally {
    setDocumentStorageForTests(null);
  }
});
