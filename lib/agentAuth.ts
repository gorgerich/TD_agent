import { prisma } from "@/lib/prisma";
import { signSession, SESSION_COOKIE } from "@/lib/session";
import type { Role } from "@/lib/auth";
import type { NextResponse } from "next/server";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeOptionalPhone(phone?: string | null): string | undefined {
  const value = phone?.trim();
  return value && value.length >= 10 ? value : undefined;
}

export function setAgentSessionCookie(
  res: NextResponse,
  token: string,
): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}

export async function createAgentSession(params: {
  userId: number;
  agentId: number;
  role?: Role;
  name?: string | null;
}): Promise<string> {
  const [membership, user] = await Promise.all([
    prisma.membership.findFirst({
      where: { userId: params.userId, agentId: params.agentId },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: params.userId },
      select: { sessionVersion: true },
    }),
  ]);
  return signSession({
    userId: params.userId,
    sessionVersion: user.sessionVersion,
    activeMembershipId: membership?.id,
    version: 2,
    name: params.name ?? "Агент",
  });
}

export async function createUserSession(params: {
  userId: number;
  activeMembershipId?: string;
  mfaVerified?: boolean;
  name?: string | null;
}): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { sessionVersion: true },
  });
  return createVersionBoundUserSession({
    ...params,
    sessionVersion: user.sessionVersion,
  });
}

export async function createVersionBoundUserSession(params: {
  userId: number;
  sessionVersion: number;
  activeMembershipId?: string;
  mfaVerified?: boolean;
  name?: string | null;
}): Promise<string> {
  return signSession({
    userId: params.userId,
    sessionVersion: params.sessionVersion,
    mfaVerified: params.mfaVerified,
    activeMembershipId: params.activeMembershipId,
    version: 2,
    name: params.name ?? undefined,
  });
}

export async function getDefaultAgentTierId(): Promise<number> {
  const tier = await prisma.agentTier.upsert({
    where: { name: "Стандарт" },
    update: {},
    create: { name: "Стандарт", commissionPct: "10.00" },
  });

  return tier.id;
}
