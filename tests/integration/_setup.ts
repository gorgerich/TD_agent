import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { signSession, SESSION_COOKIE } from "../../lib/session";
import { isIsolatedTestDatabase } from "./testDatabaseSafety";

/**
 * Integration-test harness. Runs against a DEDICATED test/branch DB — NEVER prod.
 *
 * The route handlers use the app prisma singleton (bound to DATABASE_URL), so the
 * runner MUST point DATABASE_URL at the throwaway branch. `npm run test:integration`
 * maps TEST_DATABASE_URL → DATABASE_URL/UNPOOLED and sets ALLOW_DB_TESTS=1.
 *
 * Enable explicitly:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/td_agent_test npm run test:integration
 *
 * Guards (any false → suite skipped, never touches a DB):
 *   - ALLOW_DB_TESTS must equal "1"
 *   - TEST_DATABASE_URL must be set (forces a conscious throwaway-branch choice)
 *
 * These tests CREATE and DELETE rows. Point them only at a throwaway Neon branch,
 * NOT at the shared production DB.
 */

if (
  process.env.ALLOW_DB_TESTS === "1" &&
  process.env.TEST_DATABASE_URL &&
  !isIsolatedTestDatabase(process.env.TEST_DATABASE_URL)
) {
  throw new Error(
    "Integration tests only run against the local throwaway database named td_agent_test.",
  );
}

export const dbTestsEnabled =
  process.env.ALLOW_DB_TESTS === "1" && isIsolatedTestDatabase(process.env.TEST_DATABASE_URL);

export const skip = !dbTestsEnabled;
export const db = prisma;

/** Cookie header carrying a valid agent session (to call route handlers). */
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
  makeAgent(tag: string): Promise<{ userId: number; agentId: number }>;
  trackUser(userId: number): void;
  cleanup(): Promise<void>;
};

/** Isolated root-fixture registry. No context can discover or delete another context's rows. */
export function createFixtureContext(label: string): IntegrationFixtureContext {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24);
  const runId = `${safeLabel}-${process.pid}-${randomBytes(6).toString("hex")}`;
  const userIds = new Set<number>();
  const agentIds = new Set<number>();
  let agentSequence = 0;

  return {
    runId,
    async makeAgent(tag) {
      agentSequence += 1;
      const safeTag = tag.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24);
      const email = `it-${runId}-${safeTag}-${agentSequence}@test.local`;
      const agent = await db.agent.create({
        data: {
          status: "ACTIVE",
          selfEmployed: true,
          tier: { connect: { id: await ensureTier() } },
          user: { create: { email, name: `IT ${safeTag}` } },
        },
      });
      userIds.add(agent.userId);
      agentIds.add(agent.id);
      return { userId: agent.userId, agentId: agent.id };
    },
    trackUser(userId) {
      userIds.add(userId);
    },
    async cleanup() {
      if (skip) return;
      const ownAgentIds = [...agentIds];
      const ownUserIds = [...userIds];

      if (ownAgentIds.length) {
        const meetings = await db.meeting.findMany({
          where: { agentId: { in: ownAgentIds } },
          select: { id: true },
        });
        const meetingIds = meetings.map((meeting) => meeting.id);
        const quotes = meetingIds.length
          ? await db.quote.findMany({ where: { meetingId: { in: meetingIds } }, select: { id: true } })
          : [];
        const quoteIds = quotes.map((quote) => quote.id);
        const orders = await db.order.findMany({
          where: {
            OR: [
              { agentId: { in: ownAgentIds } },
              ...(meetingIds.length ? [{ meetingId: { in: meetingIds } }] : []),
            ],
          },
          select: { id: true },
        });
        const orderIds = orders.map((order) => order.id);

        await db.commission.deleteMany({
          where: { OR: [{ agentId: { in: ownAgentIds } }, { orderId: { in: orderIds } }] },
        });
        await db.payout.deleteMany({ where: { agentId: { in: ownAgentIds } } });
        if (orderIds.length) await db.signature.deleteMany({ where: { orderId: { in: orderIds } } });
        await db.payment.deleteMany({
          where: {
            OR: [
              ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
              ...(meetingIds.length ? [{ meetingId: { in: meetingIds } }] : []),
            ],
          },
        });
        if (quoteIds.length) await db.quoteVersion.deleteMany({ where: { quoteId: { in: quoteIds } } });
        if (quoteIds.length) await db.quote.deleteMany({ where: { id: { in: quoteIds } } });
        if (orderIds.length) await db.order.deleteMany({ where: { id: { in: orderIds } } });
        if (meetingIds.length) await db.agentSession.deleteMany({ where: { meetingId: { in: meetingIds } } });
        if (meetingIds.length) await db.meeting.deleteMany({ where: { id: { in: meetingIds } } });
        await db.clientLead.deleteMany({ where: { agentId: { in: ownAgentIds } } });
        await db.agentCatalogItem.deleteMany({ where: { agentId: { in: ownAgentIds } } });
        await db.agent.deleteMany({ where: { id: { in: ownAgentIds } } });
      }
      if (ownUserIds.length) await db.user.deleteMany({ where: { id: { in: ownUserIds } } });

      agentIds.clear();
      userIds.clear();
    },
  };
}
