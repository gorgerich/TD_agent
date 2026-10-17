import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import type { PlatformContext } from "../lib/platformAuth";
import { assignFirstOrganizationAdminInTransaction, FirstOrganizationAdminCommand, type FirstOrganizationAdminInput } from "../lib/platformFirstOrganizationAdmin";
import { ADMIN_CONFIRMATION, assertNotLastActiveAdmin } from "../lib/organizationAdmin";
import { hasCapability } from "../lib/operationalAuth";

const owner: PlatformContext = {
  userId: 7, platformRole: "SUPER_ADMIN", platformMfaEnabled: true, mfaVerified: true,
  sessionVersion: 0, sessionIssuedAtEpochSeconds: 1, hasOperationalAccess: false,
};
const command: FirstOrganizationAdminInput = {
  organizationId: "org-a", membershipId: "member-a", confirmation: ADMIN_CONFIRMATION,
  reason: "Owner approved bootstrap", idempotencyKey: "command-a", correlationId: "trace-a",
};

function fixture() {
  const state = {
    organization: { status: "ACTIVE" },
    organizationMissing: false, targetReads: 0,
    actor: { sessionVersion: 0, platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() as Date | null }, actorMissing: false,
    locks: [] as string[],
    member: { id: "member-a", organizationId: "org-a", role: "AGENT", status: "ACTIVE", agentId: 9, agent: { status: "ACTIVE" }, user: { platformRole: "USER" } },
    existingAdmin: false, pendingAdmin: false, bootstrapped: false,
    audits: [] as { id: string; actorUserId: number; targetId: string; metadata: Record<string, unknown> }[], writes: 0, reads: 0,
  };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { state.reads++; state.locks.push(strings.join("?")); return []; },
    user: { findUnique: async () => state.actorMissing ? null : structuredClone(state.actor) },
    organization: { findUnique: async () => { state.targetReads++; return state.organizationMissing ? null : state.organization; } },
    membership: {
      findFirst: async ({ where }: { where: { role?: string; id?: string; organizationId?: string } }) => where.role === "ADMIN"
        ? (state.existingAdmin || state.member.role === "ADMIN" ? { id: "admin" } : null)
        : where.id === state.member.id && where.organizationId === state.member.organizationId ? structuredClone(state.member) : null,
      update: async ({ data }: { data: { role: string } }) => { state.writes++; state.member.role = data.role; return state.member; },
      count: async () => state.member.role === "ADMIN" ? 1 : 0,
    },
    organizationInvite: { findFirst: async () => state.pendingAdmin ? { id: "invite" } : null },
    platformAuditEvent: {
      findUnique: async ({ where }: { where: { id: string } }) => state.audits.find((audit) => audit.id === where.id) ?? null,
      findFirst: async () => state.bootstrapped ? { id: "previous" } : state.audits[0] ?? null,
      create: async ({ data }: { data: typeof state.audits[number] }) => { state.audits.push(data); return data; },
    },
  } as unknown as Prisma.TransactionClient;
  return { state, tx, run: (input = command, context = owner) => assignFirstOrganizationAdminInTransaction(tx, context, input) };
}

test("CPO-02 requires platform owner AND enabled/verified MFA before reads, even on replay", async () => {
  for (const context of [
    { ...owner, platformRole: "USER" }, { ...owner, platformMfaEnabled: false }, { ...owner, mfaVerified: false },
  ]) {
    const f = fixture();
    await assert.rejects(f.run(command, context as PlatformContext), { status: 403 });
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.writes, 0);
  }
  const f = fixture();
  await f.run();
  await assert.rejects(f.run(command, { ...owner, mfaVerified: false }), { status: 403 });
});

test("CPO-02 strict command prevents tenant/platform role mass assignment and requires exact confirmation/metadata", async () => {
  for (const extra of [{ platformRole: "SUPER_ADMIN" }, { role: "FINANCE" }, { confirmation: "yes" }, { reason: "" }, { idempotencyKey: "" }, { correlationId: "" }]) {
    assert.equal(FirstOrganizationAdminCommand.safeParse({ ...command, ...extra }).success, false);
    const f = fixture();
    await assert.rejects(f.run({ ...command, ...extra } as FirstOrganizationAdminInput), { status: 400 });
    assert.equal(f.state.reads, 0);
  }
});

test("CPO-02 respects release freeze before reads", async () => {
  const previous = process.env.RELEASE_WRITE_FREEZE;
  process.env.RELEASE_WRITE_FREEZE = "enabled";
  try {
    const f = fixture();
    await assert.rejects(f.run(), { status: 503 });
    assert.equal(f.state.reads, 0);
  } finally {
    if (previous === undefined) delete process.env.RELEASE_WRITE_FREEZE;
    else process.env.RELEASE_WRITE_FREEZE = previous;
  }
});

test("CPO-02 promotes only the selected tenant member; durable replay is payload and actor bound", async () => {
  const f = fixture();
  assert.equal((await f.run()).replayed, false);
  assert.equal(f.state.member.role, "ADMIN");
  assert.equal(f.state.member.user.platformRole, "USER");
  assert.equal((await f.run()).replayed, true);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.audits.length, 1);
  assert.equal(f.state.audits[0].actorUserId, owner.userId);
  assert.equal(f.state.audits[0].targetId, command.organizationId);
  assert.deepEqual(f.state.audits[0].metadata.before, { role: "AGENT", status: "ACTIVE" });
  assert.equal(f.state.audits[0].metadata.correlationId, command.correlationId);
  for (const input of [{ ...command, membershipId: "other" }, { ...command, reason: "Another reason" }]) {
    await assert.rejects(f.run(input), { status: 409, code: "IDEMPOTENCY_CONFLICT" });
  }
  await assert.rejects(f.run(command, { ...owner, userId: 8 }), { status: 409, code: "IDEMPOTENCY_CONFLICT" });
  // Replaying an old success must never restore a subsequently changed role.
  f.state.member.role = "MANAGER";
  await f.run();
  assert.equal(f.state.member.role, "MANAGER");
  await assert.rejects(f.run({ ...command, idempotencyKey: "new-key" }), { status: 409 });
});

test("CPO-02 refuses cross-tenant, suspended/non-operational/platform targets and preserves existing admins", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.state.member.organizationId = "org-b"; },
    (f: ReturnType<typeof fixture>) => { f.state.member.status = "SUSPENDED"; },
    (f: ReturnType<typeof fixture>) => { f.state.member.agent.status = "BANNED"; },
    (f: ReturnType<typeof fixture>) => { f.state.member.agentId = 0; },
    (f: ReturnType<typeof fixture>) => { f.state.member.user.platformRole = "SUPER_ADMIN"; },
    (f: ReturnType<typeof fixture>) => { f.state.organization.status = "SUSPENDED"; },
    (f: ReturnType<typeof fixture>) => { f.state.existingAdmin = true; },
    (f: ReturnType<typeof fixture>) => { f.state.pendingAdmin = true; },
    (f: ReturnType<typeof fixture>) => { f.state.bootstrapped = true; },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.run());
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.audits.length, 0);
  }
});

test("CPO-02 first ADMIN unlocks existing invitations, not platform rights; last-admin guard remains intact", async () => {
  const f = fixture();
  await f.run();
  assert.equal(hasCapability("ADMIN", "membership:invite"), true);
  for (const role of ["AGENT", "MANAGER", "FINANCE", "DOCUMENT_REVIEWER"] as const) assert.equal(hasCapability(role, "membership:invite"), false);
  for (const next of [{ role: "AGENT" as const }, { status: "SUSPENDED" as const }]) {
    await assert.rejects(assertNotLastActiveAdmin(f.tx, { id: "member-a", organizationId: "org-a", role: "ADMIN", status: "ACTIVE" }, next), { code: "LAST_ACTIVE_ADMIN" });
  }
});

test("CPO-02 current actor version, platform role and MFA are checked before mutation and replay", async () => {
  const revoke = [
    (f: ReturnType<typeof fixture>) => { f.state.actor.sessionVersion++; },
    (f: ReturnType<typeof fixture>) => { f.state.actor.platformRole = "USER"; },
    (f: ReturnType<typeof fixture>) => { f.state.actor.platformMfaEnabledAt = null; },
    (f: ReturnType<typeof fixture>) => { f.state.actorMissing = true; },
  ];
  for (const change of revoke) {
    for (const replay of [false, true]) {
      const f = fixture();
      if (replay) await f.run();
      const writes = f.state.writes;
      const audits = f.state.audits.length;
      change(f);
      await assert.rejects(f.run(), { status: 403 });
      assert.equal(f.state.writes, writes);
      assert.equal(f.state.audits.length, audits);
      assert.equal(f.state.member.role, replay ? "ADMIN" : "AGENT");
    }
  }
  const f = fixture();
  await f.run();
  assert.deepEqual(f.state.locks.map((sql) => sql.match(/FROM "(Organization|User|Membership)"/)?.[1]), ["Organization", "User", "Membership"]);
});

test("CPO-02 rejects reserved server command namespaces before reads", async () => {
  for (const prefix of ["server:", "projection:", "quote:", "finance-mfa-enabled:"]) {
    const f = fixture();
    await assert.rejects(f.run({ ...command, idempotencyKey: `${prefix}bootstrap` }), { status: 400 });
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.audits.length, 0);
  }
});

test("CPO-02 revoked actor cannot learn missing/suspended organization state", async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    f.state.actor.sessionVersion++;
    f.state.organizationMissing = missing;
    f.state.organization.status = "SUSPENDED";
    await assert.rejects(f.run(), { status: 403 });
    assert.equal(f.state.targetReads, 0);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.audits.length, 0);
    assert.deepEqual(f.state.locks.map((sql) => sql.match(/FROM "(Organization|User|Membership)"/)?.[1]), ["Organization", "User"]);
  }
});
