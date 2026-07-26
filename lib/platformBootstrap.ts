import type { Prisma } from "@prisma/client";
import { normalizeEmail } from "@/lib/agentAuth";
import { appendPlatformAudit } from "@/lib/platformAudit";

export class PlatformBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformBootstrapError";
  }
}

export async function bootstrapPlatformSuperAdmin(
  client: Prisma.TransactionClient,
  emailInput: string,
): Promise<{ userId: number; replayed: boolean }> {
  const email = normalizeEmail(emailInput);
  const user = await client.user.findUnique({
    where: { email },
    select: { id: true, platformRole: true, passwordHash: true },
  });
  if (!user) {
    throw new PlatformBootstrapError("User not found. Create and verify the account through the canonical registration flow first.");
  }
  if (!user.passwordHash) {
    throw new PlatformBootstrapError("User has no password credential. Set a strong password through the canonical account flow first.");
  }
  if (user.platformRole === "SUPER_ADMIN") return { userId: user.id, replayed: true };

  await client.user.update({
    where: { id: user.id },
    data: { platformRole: "SUPER_ADMIN" },
  });
  await appendPlatformAudit(client, {
    actorUserId: user.id,
    action: "PLATFORM_ROLE_BOOTSTRAPPED",
    targetType: "user",
    targetId: String(user.id),
    metadata: { before: "USER", after: "SUPER_ADMIN", source: "trusted-bootstrap" },
  });
  return { userId: user.id, replayed: false };
}
