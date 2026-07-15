import { createHash } from "node:crypto";
import { Prisma, type AgentStatus, type PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/password";

export const SMOKE_ACCOUNT_EMAIL = "release-smoke@synthetic.invalid";
export const SMOKE_ACCOUNT_NAME = "Release Smoke Agent";

export type SmokeAccountAction = "provision" | "rotate" | "disable" | "enable" | "status";

export type SmokeAccountAudit = {
  action: SmokeAccountAction;
  accountRef: string;
  userId: number;
  agentId: number;
  tenantId: string;
  status: AgentStatus;
  created: boolean;
  replayed: boolean;
  leadCount: number;
  meetingCount: number;
  at: string;
};

type SmokeAccountInput = {
  action: SmokeAccountAction;
  password?: string;
  newPassword?: string;
  now?: Date;
};

export async function manageSmokeAccount(db: PrismaClient, input: SmokeAccountInput): Promise<SmokeAccountAudit> {
  validateInput(input);

  return db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: SMOKE_ACCOUNT_EMAIL },
      include: { agent: true },
    });

    let user = existing;
    let created = false;
    let replayed = false;

    if (!user) {
      if (input.action !== "provision") throw new Error("Smoke account is not provisioned");
      const tier = await tx.agentTier.findFirst({ orderBy: [{ commissionPct: "asc" }, { id: "asc" }] });
      if (!tier) throw new Error("Smoke account requires an existing AgentTier");

      user = await tx.user.create({
        data: {
          email: SMOKE_ACCOUNT_EMAIL,
          name: SMOKE_ACCOUNT_NAME,
          phone: null,
          passwordHash: hashPassword(input.password!),
          agent: {
            create: {
              status: "ACTIVE",
              tierId: tier.id,
              selfEmployed: false,
              onboardingCompleted: true,
              notifyEnabled: false,
            },
          },
        },
        include: { agent: true },
      });
      created = true;
    } else {
      assertSyntheticAccount(user);
      if (!user.agent) throw new Error("Synthetic smoke user has no Agent profile");

      if (input.action === "provision") {
        if (!verifyPassword(input.password!, user.passwordHash)) {
          throw new Error("Smoke account exists with different credentials; use rotate");
        }
        replayed = true;
      } else if (input.action === "rotate") {
        assertCurrentPassword(input.password!, user.passwordHash);
        user = await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: hashPassword(input.newPassword!) },
          include: { agent: true },
        });
      } else if (input.action === "disable") {
        assertCurrentPassword(input.password!, user.passwordHash);
        user = await tx.user.update({
          where: { id: user.id },
          data: { agent: { update: { status: "SUSPENDED" } } },
          include: { agent: true },
        });
      } else if (input.action === "enable") {
        assertCurrentPassword(input.password!, user.passwordHash);
        user = await tx.user.update({
          where: { id: user.id },
          data: { agent: { update: { status: "ACTIVE" } } },
          include: { agent: true },
        });
      }
    }

    if (!user.agent) throw new Error("Smoke account Agent profile was not created");
    const [leadCount, meetingCount] = await Promise.all([
      tx.clientLead.count({ where: { agentId: user.agent.id } }),
      tx.meeting.count({ where: { agentId: user.agent.id } }),
    ]);
    if ((leadCount !== 0 || meetingCount !== 0) && ["provision", "enable"].includes(input.action)) {
      throw new Error("Smoke account is not empty; refusing operation");
    }

    return {
      action: input.action,
      accountRef: createHash("sha256").update(SMOKE_ACCOUNT_EMAIL).digest("hex").slice(0, 16),
      userId: user.id,
      agentId: user.agent.id,
      tenantId: `agent:${user.agent.id}`,
      status: user.agent.status,
      created,
      replayed,
      leadCount,
      meetingCount,
      at: (input.now ?? new Date()).toISOString(),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function validateInput(input: SmokeAccountInput): void {
  if (["provision", "disable", "enable", "rotate"].includes(input.action)) {
    assertStrongPassword(input.password, "SMOKE_ACCOUNT_PASSWORD");
  }
  if (input.action === "rotate") {
    assertStrongPassword(input.newPassword, "SMOKE_ACCOUNT_NEW_PASSWORD");
    if (input.password === input.newPassword) throw new Error("New smoke password must differ from current password");
  }
}

function assertStrongPassword(value: string | undefined, label: string): asserts value is string {
  if (!value || value.length < 32) throw new Error(`${label} must contain at least 32 characters`);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  if (classes < 3) throw new Error(`${label} must contain at least three character classes`);
}

function assertSyntheticAccount(user: {
  email: string | null;
  name: string | null;
  phone: string | null;
  passwordHash: string | null;
}): void {
  if (user.email !== SMOKE_ACCOUNT_EMAIL || user.name !== SMOKE_ACCOUNT_NAME || user.phone !== null || !user.passwordHash) {
    throw new Error("Reserved smoke identity does not match canonical synthetic account");
  }
}

function assertCurrentPassword(password: string, storedHash: string | null): void {
  if (!verifyPassword(password, storedHash)) throw new Error("Current smoke password is invalid");
}
