import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { hashPassword } from "@/lib/password";
import {
  consumePlatformActivation,
  PlatformActivationError,
  PLATFORM_ACTIVATION_INVALID_MESSAGE,
  validatePlatformAdminPassword,
  verifyPlatformActivation,
} from "@/lib/platformActivation";
import { prisma } from "@/lib/prisma";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VerifyBody = z.object({
  action: z.literal("VERIFY"),
  token: z.string().min(1).max(256),
}).strict();

const ActivateBody = z.object({
  action: z.literal("ACTIVATE"),
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(128),
  confirmation: z.string().min(1).max(128),
  mfaCode: z.string().regex(/^\d{6}$/),
}).strict();

const Body = z.discriminatedUnion("action", [VerifyBody, ActivateBody]);

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidActivationResponse();

  if (parsed.data.action === "VERIFY") {
    const limited = await enforcePersistentRateLimit(req, "platform-activation-verify", 10, 60_000);
    if (limited) return limited;
    try {
      const setup = await prisma.$transaction((tx) => verifyPlatformActivation(tx, parsed.data.token));
      return setup
      ? noStoreJson({ valid: true, mfaSecret: setup.secret, mfaUri: setup.uri })
      : invalidActivationResponse();
    } catch {
      return infrastructureFailureResponse();
    }
  }

  const activationInput = parsed.data;
  const limited = await enforcePersistentRateLimit(req, "platform-activation-consume", 5, 15 * 60_000);
  if (limited) return limited;
  try {
    validatePlatformAdminPassword(activationInput.password, activationInput.confirmation);
    // PBKDF2 completes before opening the transaction. User + activation writes
    // remain atomic while no transaction waits on CPU-bound hashing.
    const passwordHash = hashPassword(activationInput.password);
    const activated = await prisma.$transaction((tx) => consumePlatformActivation(tx, {
      token: activationInput.token,
      passwordHash,
      mfaCode: activationInput.mfaCode,
    }));
    const session = await createUserSession({ userId: activated.userId, mfaVerified: true });
    return setAgentSessionCookie(
      noStoreJson({ ok: true, redirectTo: "/platform-admin" }),
      session,
    );
  } catch (error) {
    return platformActivationFailureResponse(error);
  }
}

export function platformActivationFailureResponse(error: unknown) {
  if (error instanceof PlatformActivationError) {
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

function invalidActivationResponse() {
  return noStoreJson({ error: PLATFORM_ACTIVATION_INVALID_MESSAGE }, { status: 400 });
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
