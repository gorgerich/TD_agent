import type { PlatformRole } from "@prisma/client";
import {
  AuthenticationError,
  getCurrentUserSession,
  getCurrentUserSessionFromRequest,
  type AuthenticatedUserSession,
} from "@/lib/auth";

export type PlatformCapability =
  | "platform:dashboard-read"
  | "platform:organizations-read"
  | "platform:organizations-manage"
  | "platform:users-read"
  | "platform:audit-read";

const PLATFORM_CAPABILITIES: Record<PlatformRole, ReadonlySet<PlatformCapability>> = {
  USER: new Set(),
  SUPER_ADMIN: new Set([
    "platform:dashboard-read",
    "platform:organizations-read",
    "platform:organizations-manage",
    "platform:users-read",
    "platform:audit-read",
  ]),
};

export type PlatformContext = AuthenticatedUserSession & {
  platformRole: "SUPER_ADMIN";
};

export function hasPlatformCapability(role: PlatformRole, capability: PlatformCapability): boolean {
  return PLATFORM_CAPABILITIES[role].has(capability);
}

export function assertPlatformCapability(context: PlatformContext, capability: PlatformCapability): void {
  if (!hasPlatformCapability(context.platformRole, capability)) {
    throw new AuthenticationError(403, "Недостаточно прав платформы");
  }
}

export async function getPlatformContext(req?: Request): Promise<PlatformContext | null> {
  const user = req ? await getCurrentUserSessionFromRequest(req) : await getCurrentUserSession();
  return user?.platformRole === "SUPER_ADMIN" ? { ...user, platformRole: "SUPER_ADMIN" } : null;
}

export async function requirePlatformAdmin(req?: Request): Promise<PlatformContext> {
  const user = req ? await getCurrentUserSessionFromRequest(req) : await getCurrentUserSession();
  if (!user) throw new AuthenticationError(401, "Unauthorized");
  if (user.platformRole !== "SUPER_ADMIN") throw new AuthenticationError(403, "Доступ только владельцу платформы");
  return { ...user, platformRole: "SUPER_ADMIN" };
}
