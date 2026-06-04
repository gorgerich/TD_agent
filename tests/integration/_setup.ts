import { NextRequest } from "next/server";
import { prisma } from "../../lib/prisma";
import { signSession, SESSION_COOKIE } from "../../lib/session";

/**
 * Integration-test harness. Runs against a DEDICATED test/branch DB — NEVER prod.
 *
 * The route handlers use the app prisma singleton (bound to DATABASE_URL), so the
 * runner MUST point DATABASE_URL at the throwaway branch. `npm run test:integration`
 * maps TEST_DATABASE_URL → DATABASE_URL/UNPOOLED and sets ALLOW_DB_TESTS=1.
 *
 * Enable explicitly:
 *   TEST_DATABASE_URL=postgres://...neon-branch  npm run test:integration
 *
 * Guards (any false → suite skipped, never touches a DB):
 *   - ALLOW_DB_TESTS must equal "1"
 *   - TEST_DATABASE_URL must be set (forces a conscious throwaway-branch choice)
 *
 * These tests CREATE and DELETE rows. Point them only at a throwaway Neon branch,
 * NOT at the shared production DB.
 */

export const dbTestsEnabled =
  process.env.ALLOW_DB_TESTS === "1" && Boolean(process.env.TEST_DATABASE_URL);

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
  opts: { method?: string; cookie?: string; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

let tierId: number | null = null;
async function ensureTier(): Promise<number> {
  if (tierId) return tierId;
  const tier = await db.agentTier.upsert({
    where: { name: "TestTier" },
    update: {},
    create: { name: "TestTier", commissionPct: "10.00" },
  });
  tierId = tier.id;
  return tierId;
}

/** Create a throwaway agent (+user). Cleanup keyed by email prefix it-…@test.local. */
export async function makeAgent(tag: string): Promise<{ userId: number; agentId: number }> {
  const email = `it-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const agent = await db.agent.create({
    data: {
      status: "ACTIVE",
      selfEmployed: true,
      tier: { connect: { id: await ensureTier() } },
      user: { create: { email, name: `IT ${tag}` } },
    },
  });
  return { userId: agent.userId, agentId: agent.id };
}

/** Remove all rows created by integration agents. */
export async function cleanup(): Promise<void> {
  if (skip) return;
  const users = await db.user.findMany({
    where: { email: { startsWith: "it-" } },
    select: { agent: { select: { id: true } } },
  });
  const agentIds = users.map((u) => u.agent?.id).filter((x): x is number => !!x);
  if (agentIds.length) {
    await db.quoteVersion.deleteMany({ where: { quote: { meeting: { agentId: { in: agentIds } } } } });
    await db.quote.deleteMany({ where: { meeting: { agentId: { in: agentIds } } } });
    await db.agentSession.deleteMany({ where: { meeting: { agentId: { in: agentIds } } } });
    await db.meeting.deleteMany({ where: { agentId: { in: agentIds } } });
    await db.clientLead.deleteMany({ where: { agentId: { in: agentIds } } });
    await db.agent.deleteMany({ where: { id: { in: agentIds } } });
  }
  await db.user.deleteMany({ where: { email: { startsWith: "it-" } } });
}
