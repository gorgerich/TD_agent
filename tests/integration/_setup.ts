import { randomBytes } from "node:crypto";
import type { MembershipRole } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "../../lib/prisma";
import type { OperationalContext } from "../../lib/operationalAuth";
import { signSession, SESSION_COOKIE } from "../../lib/session";
import { isIsolatedTestDatabase } from "./testDatabaseSafety";

/**
 * Integration-test harness. It can connect only to exact, local throwaway DBs
 * approved in testDatabaseSafety.ts. Every context owns a registry of exact IDs;
 * cleanup never discovers fixtures by prefix or removes another context's rows.
 */
if (
  process.env.ALLOW_DB_TESTS === "1" &&
  process.env.TEST_DATABASE_URL &&
  !isIsolatedTestDatabase(process.env.TEST_DATABASE_URL)
) {
  throw new Error("Integration tests require an approved exact local throwaway database.");
}

export const dbTestsEnabled =
  process.env.ALLOW_DB_TESTS === "1" && isIsolatedTestDatabase(process.env.TEST_DATABASE_URL);

export const skip = !dbTestsEnabled;
export const db = prisma;

export type FixtureMember = {
  userId: number;
  agentId: number;
  organizationId: string;
  membershipId: string;
  role: MembershipRole;
  context: OperationalContext;
};

export type FixtureCase = {
  id: string;
  publicRef: string;
  leadId: number;
  owner: FixtureMember;
};

/** Cookie header carrying a valid legacy-shaped session. Auth must hydrate role/org from Membership. */
export async function sessionCookieHeader(userId: number, agentId: number): Promise<string> {
  const token = await signSession({ userId, agentId, role: "AGENT", name: "Test Agent" });
  return `${SESSION_COOKIE}=${token}`;
}

/** Build a Request with optional session cookie + JSON body (for route handlers). */
export function makeRequest(
  url: string,
  opts: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

let tierPromise: Promise<number> | null = null;
async function ensureTier(): Promise<number> {
  if (!tierPromise) {
    tierPromise = db.agentTier.upsert({
      where: { name: "TestTier" },
      update: {},
      create: { name: "TestTier", commissionPct: "10.00" },
      select: { id: true },
    }).then((tier) => tier.id).catch((error) => {
      tierPromise = null;
      throw error;
    });
  }
  return tierPromise;
}

export type IntegrationFixtureContext = {
  readonly runId: string;
  makeOrganization(tag: string): Promise<string>;
  makeMember(tag: string, options?: { organizationId?: string; role?: MembershipRole }): Promise<FixtureMember>;
  makeAgent(tag: string): Promise<FixtureMember>;
  makeCase(owner: FixtureMember, tag: string, options?: { ceremonyAt?: Date | null }): Promise<FixtureCase>;
  trackUser(userId: number): void;
  cleanup(): Promise<void>;
  assertNoResidue(): Promise<void>;
};

/** Isolated root-fixture registry. All cleanup predicates use exact registered IDs. */
export function createFixtureContext(label: string): IntegrationFixtureContext {
  const safeLabel = normalizeTag(label);
  const runId = `${safeLabel}-${process.pid}-${randomBytes(6).toString("hex")}`;
  const organizationIds = new Set<string>();
  const membershipIds = new Set<string>();
  const userIds = new Set<number>();
  const agentIds = new Set<number>();
  const createdOrganizationIds = new Set<string>();
  const createdMembershipIds = new Set<string>();
  const createdUserIds = new Set<number>();
  const createdAgentIds = new Set<number>();
  let organizationSequence = 0;
  let memberSequence = 0;
  let caseSequence = 0;

  async function makeOrganization(tag: string): Promise<string> {
    organizationSequence += 1;
    const suffix = `${normalizeTag(tag)}-${organizationSequence}`;
    const organization = await db.organization.create({
      data: {
        id: `it-org-${runId}-${suffix}`,
        name: `IT ${suffix}`,
        slug: `it-${runId}-${suffix}`,
        timezone: "Europe/Moscow",
      },
      select: { id: true },
    });
    organizationIds.add(organization.id);
    createdOrganizationIds.add(organization.id);
    return organization.id;
  }

  async function makeMember(
    tag: string,
    options: { organizationId?: string; role?: MembershipRole } = {},
  ): Promise<FixtureMember> {
    memberSequence += 1;
    const safeTag = normalizeTag(tag);
    const organizationId = options.organizationId ?? await makeOrganization(safeTag);
    if (!organizationIds.has(organizationId)) {
      throw new Error("Fixture context cannot attach a member to an unregistered organization");
    }
    const email = `it-${runId}-${safeTag}-${memberSequence}@test.local`;
    const agent = await db.agent.create({
      data: {
        status: "ACTIVE",
        selfEmployed: true,
        tier: { connect: { id: await ensureTier() } },
        user: { create: { email, name: `IT ${safeTag}` } },
      },
      select: { id: true, userId: true },
    });
    const membership = await db.membership.create({
      data: {
        id: `it-membership-${runId}-${memberSequence}`,
        organizationId,
        userId: agent.userId,
        agentId: agent.id,
        role: options.role ?? "AGENT",
        status: "ACTIVE",
      },
      select: { id: true, role: true },
    });
    userIds.add(agent.userId);
    agentIds.add(agent.id);
    membershipIds.add(membership.id);
    createdUserIds.add(agent.userId);
    createdAgentIds.add(agent.id);
    createdMembershipIds.add(membership.id);
    return {
      userId: agent.userId,
      agentId: agent.id,
      organizationId,
      membershipId: membership.id,
      role: membership.role,
      context: {
        userId: agent.userId,
        agentId: agent.id,
        membershipId: membership.id,
        organizationId,
        role: membership.role,
        timezone: "Europe/Moscow",
        name: `IT ${safeTag}`,
      },
    };
  }

  async function makeCase(
    owner: FixtureMember,
    tag: string,
    options: { ceremonyAt?: Date | null } = {},
  ): Promise<FixtureCase> {
    if (!organizationIds.has(owner.organizationId) || !membershipIds.has(owner.membershipId)) {
      throw new Error("Fixture case owner must belong to this context");
    }
    caseSequence += 1;
    const safeTag = normalizeTag(tag);
    const lead = await db.clientLead.create({
      data: {
        agentId: owner.agentId,
        name: `Client ${safeTag}`,
        phone: `+7000-${runId}-${caseSequence}`,
        source: "integration",
        ceremonyAt: options.ceremonyAt ?? null,
      },
      select: { id: true },
    });
    const canonicalCase = await db.case.create({
      data: {
        id: `it-case-${runId}-${caseSequence}`,
        publicRef: `IT-${runId}-${caseSequence}`,
        leadId: lead.id,
        tenantId: owner.organizationId,
        ownerId: owner.agentId,
      },
      select: { id: true, publicRef: true },
    });
    return { id: canonicalCase.id, publicRef: canonicalCase.publicRef, leadId: lead.id, owner };
  }

  async function cleanup(): Promise<void> {
    if (skip) return;
    const ownOrganizationIds = [...organizationIds];
    const ownMembershipIds = [...membershipIds];
    const ownAgentIds = [...agentIds];
    const ownUserIds = [...userIds];
    if (!ownOrganizationIds.length && !ownAgentIds.length && !ownUserIds.length) return;

    await db.$transaction(async (tx) => {
      const cases = ownOrganizationIds.length
        ? await tx.case.findMany({ where: { tenantId: { in: ownOrganizationIds } }, select: { id: true, leadId: true } })
        : [];
      const caseIds = cases.map((item) => item.id);
      const directLeads = ownAgentIds.length
        ? await tx.clientLead.findMany({ where: { agentId: { in: ownAgentIds } }, select: { id: true } })
        : [];
      const leadIds = [...new Set([...cases.map((item) => item.leadId), ...directLeads.map((item) => item.id)])];
      const meetings = ownOrganizationIds.length
        ? await tx.meeting.findMany({ where: { organizationId: { in: ownOrganizationIds } }, select: { id: true } })
        : [];
      const meetingIds = meetings.map((item) => item.id);
      const quotes = meetingIds.length
        ? await tx.quote.findMany({ where: { meetingId: { in: meetingIds } }, select: { id: true } })
        : [];
      const quoteIds = quotes.map((item) => item.id);
      const orders = await tx.order.findMany({
        where: {
          OR: [
            ...(ownAgentIds.length ? [{ agentId: { in: ownAgentIds } }] : []),
            ...(meetingIds.length ? [{ meetingId: { in: meetingIds } }] : []),
            ...(ownUserIds.length ? [{ userId: { in: ownUserIds } }] : []),
          ],
        },
        select: { id: true },
      });
      const orderIds = orders.map((item) => item.id);

      if (caseIds.length) await tx.case.updateMany({ where: { id: { in: caseIds } }, data: { publishedQuoteVersionId: null } });
      if (ownOrganizationIds.length) {
        await tx.operationalAuditEvent.deleteMany({ where: { organizationId: { in: ownOrganizationIds } } });
        await tx.projectionReceipt.deleteMany({ where: { organizationId: { in: ownOrganizationIds } } });
        await tx.savedOperationalView.deleteMany({ where: { organizationId: { in: ownOrganizationIds } } });
        await tx.organizationInvite.deleteMany({ where: { organizationId: { in: ownOrganizationIds } } });
        await tx.task.deleteMany({ where: { organizationId: { in: ownOrganizationIds } } });
      }
      if (caseIds.length) await tx.caseEvent.deleteMany({ where: { caseId: { in: caseIds } } });
      if (meetingIds.length) await tx.agentSession.deleteMany({ where: { meetingId: { in: meetingIds } } });
      if (orderIds.length) {
        await tx.signature.deleteMany({ where: { orderId: { in: orderIds } } });
        await tx.commission.deleteMany({ where: { orderId: { in: orderIds } } });
      }
      if (ownAgentIds.length) {
        await tx.commission.deleteMany({ where: { agentId: { in: ownAgentIds } } });
        await tx.payout.deleteMany({ where: { agentId: { in: ownAgentIds } } });
      }
      await tx.payment.deleteMany({
        where: {
          OR: [
            ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
            ...(meetingIds.length ? [{ meetingId: { in: meetingIds } }] : []),
          ],
        },
      });
      if (quoteIds.length) await tx.quoteVersion.deleteMany({ where: { quoteId: { in: quoteIds } } });
      if (quoteIds.length) await tx.quote.deleteMany({ where: { id: { in: quoteIds } } });
      if (orderIds.length) await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      if (meetingIds.length) await tx.meeting.deleteMany({ where: { id: { in: meetingIds } } });
      if (caseIds.length) await tx.case.deleteMany({ where: { id: { in: caseIds } } });
      if (leadIds.length) {
        await tx.document.deleteMany({ where: { leadId: { in: leadIds } } });
        await tx.casePayment.deleteMany({ where: { leadId: { in: leadIds } } });
        await tx.caseNote.deleteMany({ where: { leadId: { in: leadIds } } });
        await tx.clientLead.deleteMany({ where: { id: { in: leadIds } } });
      }
      if (ownAgentIds.length) await tx.agentCatalogItem.deleteMany({ where: { agentId: { in: ownAgentIds } } });
      if (ownMembershipIds.length) await tx.membership.deleteMany({ where: { id: { in: ownMembershipIds } } });
      if (ownAgentIds.length) await tx.agent.deleteMany({ where: { id: { in: ownAgentIds } } });
      if (ownUserIds.length) await tx.user.deleteMany({ where: { id: { in: ownUserIds } } });
      if (ownOrganizationIds.length) await tx.organization.deleteMany({ where: { id: { in: ownOrganizationIds } } });
    });

    organizationIds.clear();
    membershipIds.clear();
    agentIds.clear();
    userIds.clear();
  }

  async function assertNoResidue(): Promise<void> {
    const [organizations, memberships, agents, users, tasks, meetings, audits, receipts, views] = await Promise.all([
      db.organization.count({ where: { id: { in: [...createdOrganizationIds] } } }),
      db.membership.count({ where: { id: { in: [...createdMembershipIds] } } }),
      db.agent.count({ where: { id: { in: [...createdAgentIds] } } }),
      db.user.count({ where: { id: { in: [...createdUserIds] } } }),
      db.task.count({ where: { organizationId: { in: [...createdOrganizationIds] } } }),
      db.meeting.count({ where: { organizationId: { in: [...createdOrganizationIds] } } }),
      db.operationalAuditEvent.count({ where: { organizationId: { in: [...createdOrganizationIds] } } }),
      db.projectionReceipt.count({ where: { organizationId: { in: [...createdOrganizationIds] } } }),
      db.savedOperationalView.count({ where: { organizationId: { in: [...createdOrganizationIds] } } }),
    ]);
    const total = organizations + memberships + agents + users + tasks + meetings + audits + receipts + views;
    if (total !== 0) {
      throw new Error(`Fixture residue detected for ${runId}: ${total} rows`);
    }
  }

  return {
    runId,
    makeOrganization,
    makeMember,
    makeAgent: (tag) => makeMember(tag, { role: "AGENT" }),
    makeCase,
    trackUser: (userId) => {
      userIds.add(userId);
      createdUserIds.add(userId);
    },
    cleanup,
    assertNoResidue,
  };
}

function normalizeTag(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24) || "fixture";
}
