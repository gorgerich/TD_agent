import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createVersionBoundUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { hashPassword } from "@/lib/password";
import {
  PlatformActivationError,
  validatePlatformAdminPassword,
} from "@/lib/platformActivation";
import {
  consumePlatformOwnerRecovery,
  PlatformOwnerRecoveryError,
  PLATFORM_OWNER_RECOVERY_INVALID_MESSAGE,
  verifyPlatformOwnerRecovery,
} from "@/lib/platformOwnerRecovery";
import { prisma } from "@/lib/prisma";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VerifyBody = z.object({
  action: z.literal("VERIFY"),
  token: z.string().min(1).max(256),
}).strict();

const RecoverBody = z.object({
  action: z.literal("RECOVER"),
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(128),
  confirmation: z.string().min(1).max(128),
  mfaCode: z.string().regex(/^\d{6}$/),
}).strict();

const Body = z.discriminatedUnion("action", [VerifyBody, RecoverBody]);

export async function POST(req: NextRequest) {
  return handlePlatformOwnerRecovery(req);
}

export async function handlePlatformOwnerRecovery(
  req: NextRequest,
  rateLimiter = enforcePersistentRateLimit,
  passwordHasher: (password: string) => string | Promise<string> = hashPassword,
  eligibilityChecker: (token: string) => Promise<boolean> = async (token) => (
    Boolean(await prisma.$transaction((tx) => verifyPlatformOwnerRecovery(tx, token)))
  ),
) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRecoveryResponse();

  if (parsed.data.action === "VERIFY") {
    try {
      const limited = await rateLimiter(req, "platform-owner-recovery-verify", 8, 15 * 60_000);
      if (limited) return limited;
      const setup = await prisma.$transaction((tx) => verifyPlatformOwnerRecovery(tx, parsed.data.token));
      return setup
        ? noStoreJson({ valid: true, mfaSecret: setup.secret, mfaUri: setup.uri })
        : invalidRecoveryResponse();
    } catch {
      return infrastructureFailureResponse();
    }
  }

  const recoveryInput = parsed.data;
  try {
    const limited = await rateLimiter(req, "platform-owner-recovery-consume", 5, 15 * 60_000);
    if (limited) return limited;
    validatePlatformAdminPassword(recoveryInput.password, recoveryInput.confirmation);
    const eligible = await eligibilityChecker(recoveryInput.token);
    if (!eligible) return invalidRecoveryResponse();
    // Password hashing completes before the transaction. No plaintext or CPU
    // work is retained while the one-time credential update is locked. The
    // consume transaction rechecks token eligibility after hashing.
    const passwordHash = await passwordHasher(recoveryInput.password);
    const recovered = await prisma.$transaction((tx) => consumePlatformOwnerRecovery(tx, {
      token: recoveryInput.token,
      passwordHash,
      mfaCode: recoveryInput.mfaCode,
    }));
    // Bind the replacement cookie to the version committed by this exact
    // recovery. A concurrent later revocation must make this cookie stale.
    const session = await createVersionBoundUserSession({
      userId: recovered.userId,
      sessionVersion: recovered.sessionVersion,
      mfaVerified: true,
    });
    return setAgentSessionCookie(
      noStoreJson({ ok: true, redirectTo: "/platform-admin" }),
      session,
    );
  } catch (error) {
    return recoveryFailureResponse(error);
  }
}

export function recoveryFailureResponse(error: unknown) {
  if (error instanceof PlatformActivationError) {
    return noStoreJson({ error: error.message }, { status: error.status });
  }
  if (error instanceof PlatformOwnerRecoveryError) {
    return noStoreJson({ error: error.message }, { status: error.status });
  }
  return infrastructureFailureResponse();
}

function infrastructureFailureResponse() {
  return noStoreJson(
    { error: "Сервис временно недоступен. Повторите попытку." },
    { status: 503, headers: { "Retry-After": "5" } },
  );
}

function invalidRecoveryResponse() {
  return noStoreJson({ error: PLATFORM_OWNER_RECOVERY_INVALID_MESSAGE }, { status: 400 });
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
