import type { MembershipRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type OperationalRole = MembershipRole;

export type OperationalContext = {
  userId: number;
  agentId: number;
  membershipId: string;
  organizationId: string;
  role: OperationalRole;
  timezone: string;
  name?: string;
};

export type OperationalCapability =
  | "work:read"
  | "work:mutate-own"
  | "team:read"
  | "team:assign"
  | "audit:read"
  | "membership:invite";

const ROLE_CAPABILITIES: Record<OperationalRole, ReadonlySet<OperationalCapability>> = {
  AGENT: new Set(["work:read", "work:mutate-own"]),
  MANAGER: new Set(["work:read", "work:mutate-own", "team:read", "team:assign", "audit:read"]),
  ADMIN: new Set(["work:read", "team:read", "audit:read", "membership:invite"]),
};

export function hasCapability(role: OperationalRole, capability: OperationalCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function assertCapability(context: OperationalContext, capability: OperationalCapability): void {
  if (!hasCapability(context.role, capability)) {
    throw new OperationalAuthError(403, "Недостаточно прав для этого действия");
  }
}

export class OperationalAuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "OperationalAuthError";
  }
}

export async function resolveOperationalContext(
  userId: number,
  agentId: number,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OperationalContext | null> {
  if (userId <= 0 || agentId <= 0) return null;

  const membership = await client.membership.findFirst({
    where: { userId, agentId, status: "ACTIVE" },
    select: {
      id: true,
      organizationId: true,
      role: true,
      organization: { select: { timezone: true } },
      user: { select: { name: true } },
      agent: { select: { status: true } },
    },
  });

  if (!membership || membership.agent?.status !== "ACTIVE") return null;

  return {
    userId,
    agentId,
    membershipId: membership.id,
    organizationId: membership.organizationId,
    role: membership.role,
    timezone: membership.organization.timezone,
    name: membership.user.name ?? undefined,
  };
}

export async function requireActiveMembershipForAgent(
  agentId: number,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const membership = await client.membership.findFirst({
    where: { agentId, status: "ACTIVE" },
    select: { id: true, organizationId: true, userId: true, role: true },
  });
  if (!membership) throw new OperationalAuthError(404, "Активное членство не найдено");
  return membership;
}

export async function ensureLegacyOrganizationForAgent(
  input: { agentId: number; userId: number; agentStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "BANNED" },
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const organizationId = `agent:${input.agentId}`;
  const membershipId = `membership:agent:${input.agentId}`;
  await client.organization.upsert({
    where: { id: organizationId },
    update: {},
    create: {
      id: organizationId,
      name: `Рабочая организация ${input.agentId}`,
      slug: `legacy-agent-${input.agentId}`,
    },
  });
  const membership = await client.membership.upsert({
    where: { agentId: input.agentId },
    update: {
      organizationId,
      userId: input.userId,
      status: input.agentStatus === "ACTIVE" ? "ACTIVE" : "SUSPENDED",
    },
    create: {
      id: membershipId,
      organizationId,
      userId: input.userId,
      agentId: input.agentId,
      role: "AGENT",
      status: input.agentStatus === "ACTIVE" ? "ACTIVE" : "SUSPENDED",
    },
  });
  return { organizationId, membershipId: membership.id };
}
