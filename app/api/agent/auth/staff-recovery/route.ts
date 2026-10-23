import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createVersionBoundUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { hashPassword } from "@/lib/password";
import { PlatformActivationError, validatePlatformAdminPassword } from "@/lib/platformActivation";
import { enforcePersistentIdentityRateLimit, enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { operationalLanding } from "@/lib/operationalAuth";
import { runOperationalTransaction } from "@/lib/operationalTransaction";
import { isReleaseWriteFreezeActive } from "@/lib/releaseWriteFreeze";
import { consumeStaffAccountRecovery, hashStaffRecoveryToken, StaffAccountRecoveryError, STAFF_RECOVERY_INVALID_MESSAGE, verifyStaffAccountRecovery } from "@/lib/staffAccountRecovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("VERIFY"), token: z.string().min(1).max(256) }).strict(),
  z.object({ action: z.literal("RECOVER"), token: z.string().min(1).max(256), password: z.string().min(1).max(128),
    confirmation: z.string().min(1).max(128), mfaCode: z.string().regex(/^\d{6}$/) }).strict(),
]);
const defaults = { limiter: enforcePersistentRateLimit, identityLimiter: enforcePersistentIdentityRateLimit, passwordHasher: hashPassword };

export async function POST(req: NextRequest) { return handleStaffAccountRecovery(req); }

export async function handleStaffAccountRecovery(req: NextRequest, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  try {
    if (isReleaseWriteFreezeActive()) return json({ error: "Изменения временно приостановлены" }, 503);
    const limited = await deps.limiter(req, "staff-recovery-ip", 12, 15 * 60_000);
    if (limited) return secure(limited);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalid();
    const input = parsed.data;
    const bucket = input.action === "VERIFY" ? "staff-recovery-verify" : "staff-recovery-consume";
    const identityLimited = await deps.identityLimiter(bucket, hashStaffRecoveryToken(input.token), input.action === "VERIFY" ? 8 : 5, 15 * 60_000);
    if (identityLimited) return secure(identityLimited);
    if (input.action === "VERIFY") {
      const setup = await runOperationalTransaction((tx) => verifyStaffAccountRecovery(tx, input.token));
      return json({ valid: true, mfaSecret: setup.secret, mfaUri: setup.uri, resetMfa: setup.resetMfa });
    }
    // Eligibility precedes the KDF; consume rechecks the same boundary under locks.
    await runOperationalTransaction((tx) => verifyStaffAccountRecovery(tx, input.token));
    validatePlatformAdminPassword(input.password, input.confirmation);
    const passwordHash = deps.passwordHasher(input.password);
    const recovered = await runOperationalTransaction((tx) => consumeStaffAccountRecovery(tx, { token: input.token, passwordHash, mfaCode: input.mfaCode }));
    const token = await createVersionBoundUserSession({ userId: recovered.userId, sessionVersion: recovered.sessionVersion,
      activeMembershipId: recovered.membershipId, mfaVerified: recovered.mfaVerified });
    return setAgentSessionCookie(json({ ok: true, redirectTo: operationalLanding(recovered.role) }), token);
  } catch (error) {
    if (error instanceof StaffAccountRecoveryError) return invalid();
    if (error instanceof PlatformActivationError) return json({ error: error.message }, error.status);
    return json({ error: "Сервис временно недоступен. Повторите попытку." }, 503);
  }
}

function invalid() { return json({ error: STAFF_RECOVERY_INVALID_MESSAGE }, 400); }
function json(body: unknown, status = 200) {
  return secure(NextResponse.json(body, { status, ...(status === 503 ? { headers: { "Retry-After": "5" } } : {}) }));
}
function secure(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
