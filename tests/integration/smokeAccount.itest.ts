import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as login } from "../../app/api/agent/auth/login/route";
import { hashPassword } from "../../lib/password";
import { GET as listLeads } from "../../app/api/agent/leads/route";
import {
  manageSmokeAccount,
  SMOKE_ACCOUNT_EMAIL,
  SMOKE_ACCOUNT_NAME,
} from "../../lib/smokeAccount";
import { db, skip } from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };
const firstPassword = `${randomBytes(32).toString("base64url")}!Aa1`;
const rotatedPassword = `${randomBytes(32).toString("base64url")}!Bb2`;

async function removeSmokeAccount() {
  if (skip) return;
  const user = await db.user.findUnique({
    where: { email: SMOKE_ACCOUNT_EMAIL },
    select: { agent: { select: { id: true, membership: { select: { id: true, organizationId: true } } } } },
  });
  if (user?.agent?.membership) {
    await db.operationalAuditEvent.deleteMany({ where: { organizationId: user.agent.membership.organizationId } });
    await db.projectionReceipt.deleteMany({ where: { organizationId: user.agent.membership.organizationId } });
    await db.savedOperationalView.deleteMany({ where: { organizationId: user.agent.membership.organizationId } });
    await db.organizationInvite.deleteMany({ where: { organizationId: user.agent.membership.organizationId } });
    await db.membership.delete({ where: { id: user.agent.membership.id } });
    await db.organization.delete({ where: { id: user.agent.membership.organizationId } });
  }
  if (user?.agent) await db.agent.delete({ where: { id: user.agent.id } });
  if (user) await db.user.delete({ where: { email: SMOKE_ACCOUNT_EMAIL } });
}

async function ensureTestTier() {
  if (skip) return;
  await db.agentTier.upsert({
    where: { name: "SmokeAccountTestTier" },
    update: {},
    create: { name: "SmokeAccountTestTier", commissionPct: "0.00" },
  });
}

function loginRequest(password: string) {
  return login(new NextRequest("http://localhost/api/agent/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `smoke-${Date.now()}-${Math.random()}` },
    body: JSON.stringify({ email: SMOKE_ACCOUNT_EMAIL, password }),
  }));
}

beforeEach(async () => {
  await removeSmokeAccount();
  await ensureTestTier();
});
afterEach(removeSmokeAccount);

test("smoke provisioning hashes before opening its transaction", opts, async () => {
  let hashFinishedAt = 0;
  let transactionStartedAt = 0;
  const observedDb = Object.create(db) as typeof db;
  const runTransaction = db.$transaction.bind(db);
  observedDb.$transaction = ((...args: unknown[]) => {
    transactionStartedAt = performance.now();
    return Reflect.apply(runTransaction, db, args);
  }) as typeof db.$transaction;

  const provisioned = await manageSmokeAccount(
    observedDb,
    { action: "provision", password: firstPassword },
    {
      hashPassword: async (password) => {
        await new Promise((resolve) => setTimeout(resolve, 5_100));
        const result = hashPassword(password);
        hashFinishedAt = performance.now();
        return result;
      },
    },
  );

  assert.equal(provisioned.created, true);
  assert.ok(hashFinishedAt > 0);
  assert.ok(transactionStartedAt >= hashFinishedAt);
  assert.equal(await db.user.count({ where: { email: SMOKE_ACCOUNT_EMAIL } }), 1);
  assert.equal(await db.agent.count({ where: { user: { email: SMOKE_ACCOUNT_EMAIL } } }), 1);
  assert.equal(await db.organization.count({ where: { id: provisioned.tenantId } }), 1);
  assert.equal(await db.membership.count({ where: { agentId: provisioned.agentId, status: "ACTIVE" } }), 1);
  assert.equal(await db.clientLead.count({ where: { agentId: provisioned.agentId } }), 0);
  assert.equal(await db.meeting.count({ where: { agentId: provisioned.agentId } }), 0);
  assert.equal(await db.case.count({ where: { ownerId: provisioned.agentId } }), 0);
  assert.equal(await db.caseEvent.count({ where: { actorId: provisioned.agentId } }), 0);
});

test("smoke provisioning retries a serializable write conflict without losing atomicity", opts, async () => {
  let attempts = 0;
  const observedDb = Object.create(db) as typeof db;
  const runTransaction = db.$transaction.bind(db);
  observedDb.$transaction = ((...args: unknown[]) => {
    attempts += 1;
    if (attempts === 1) {
      throw new Prisma.PrismaClientKnownRequestError("Synthetic serializable conflict", {
        code: "P2034",
        clientVersion: Prisma.prismaVersion.client,
      });
    }
    return Reflect.apply(runTransaction, db, args);
  }) as typeof db.$transaction;

  const provisioned = await manageSmokeAccount(observedDb, { action: "provision", password: firstPassword });
  assert.equal(attempts, 2);
  assert.equal(provisioned.created, true);
  assert.equal(await db.user.count({ where: { email: SMOKE_ACCOUNT_EMAIL } }), 1);
  assert.equal(await db.agent.count({ where: { user: { email: SMOKE_ACCOUNT_EMAIL } } }), 1);
  assert.equal(await db.membership.count({ where: { agentId: provisioned.agentId } }), 1);
});

test("smoke provisioning rolls back User when nested Agent creation fails", opts, async () => {
  await assert.rejects(
    db.user.create({
      data: {
        email: SMOKE_ACCOUNT_EMAIL,
        name: SMOKE_ACCOUNT_NAME,
        passwordHash: hashPassword(firstPassword),
        agent: {
          create: {
            status: "ACTIVE",
            tierId: -1,
            selfEmployed: false,
            onboardingCompleted: true,
            notifyEnabled: false,
          },
        },
      },
    }),
  );
  assert.equal(await db.user.count({ where: { email: SMOKE_ACCOUNT_EMAIL } }), 0);
  assert.equal(await db.agent.count({ where: { user: { email: SMOKE_ACCOUNT_EMAIL } } }), 0);
});

test("release smoke account lifecycle is atomic, idempotent, isolated and password-only", opts, async () => {
  const provisioned = await manageSmokeAccount(db, { action: "provision", password: firstPassword });
  assert.equal(provisioned.created, true);
  assert.equal(provisioned.status, "ACTIVE");
  assert.equal(provisioned.leadCount, 0);
  assert.equal(provisioned.meetingCount, 0);
  assert.equal((await loginRequest(firstPassword)).status, 200);

  const replay = await manageSmokeAccount(db, { action: "provision", password: firstPassword });
  assert.equal(replay.created, false);
  assert.equal(replay.replayed, true);
  assert.equal(await db.user.count({ where: { email: SMOKE_ACCOUNT_EMAIL } }), 1);
  assert.equal(await db.agent.count({ where: { user: { email: SMOKE_ACCOUNT_EMAIL } } }), 1);
  assert.equal(await db.membership.count({ where: { agentId: provisioned.agentId } }), 1);

  const otherUser = await db.user.create({ data: { email: `smoke-other-${Date.now()}@test.invalid`, name: "Other tenant" } });
  const tier = await db.agentTier.findFirstOrThrow();
  const otherAgent = await db.agent.create({ data: { userId: otherUser.id, tierId: tier.id, status: "ACTIVE" } });
  const foreignLead = await db.clientLead.create({
    data: { agentId: otherAgent.id, name: "Foreign synthetic lead", phone: "+70000000000", source: "test" },
  });

  const loginResponse = await loginRequest(firstPassword);
  const cookie = loginResponse.headers.get("set-cookie");
  assert.ok(cookie);
  const leadsResponse = await listLeads(new NextRequest("http://localhost/api/agent/leads", { headers: { cookie } }));
  assert.equal(leadsResponse.status, 200);
  assert.deepEqual(await leadsResponse.json(), []);
  assert.equal(await db.clientLead.count({ where: { agentId: provisioned.agentId } }), 0);

  await manageSmokeAccount(db, { action: "disable", password: firstPassword });
  assert.equal((await loginRequest(firstPassword)).status, 403);
  await manageSmokeAccount(db, { action: "enable", password: firstPassword });
  assert.equal((await loginRequest(firstPassword)).status, 200);

  await manageSmokeAccount(db, { action: "rotate", password: firstPassword, newPassword: rotatedPassword });
  assert.equal((await loginRequest(firstPassword)).status, 401);
  assert.equal((await loginRequest(rotatedPassword)).status, 200);

  const contamination = await db.clientLead.create({
    data: { agentId: provisioned.agentId, name: "Synthetic contamination", phone: "+70000000003", source: "test" },
  });
  const contained = await manageSmokeAccount(db, { action: "disable", password: rotatedPassword });
  assert.equal(contained.status, "SUSPENDED");
  assert.equal(contained.leadCount, 1);
  await assert.rejects(
    manageSmokeAccount(db, { action: "enable", password: rotatedPassword }),
    /not empty/,
  );
  await db.clientLead.delete({ where: { id: contamination.id } });
  await manageSmokeAccount(db, { action: "enable", password: rotatedPassword });

  await db.clientLead.delete({ where: { id: foreignLead.id } });
  await db.agent.delete({ where: { id: otherAgent.id } });
  await db.user.delete({ where: { id: otherUser.id } });
});
