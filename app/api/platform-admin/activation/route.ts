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
import { enforceRateLimit } from "@/lib/rateLimit";

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
}).strict();

const Body = z.discriminatedUnion("action", [VerifyBody, ActivateBody]);

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidActivationResponse();

  if (parsed.data.action === "VERIFY") {
    const limited = enforceRateLimit(req, "platform-activation-verify", 10, 60_000);
    if (limited) return limited;
    const valid = await prisma.$transaction((tx) => verifyPlatformActivation(tx, parsed.data.token));
    return valid
      ? noStoreJson({ valid: true })
      : invalidActivationResponse();
  }

  const limited = enforceRateLimit(req, "platform-activation-consume", 5, 15 * 60_000);
  if (limited) return limited;
  try {
    validatePlatformAdminPassword(parsed.data.password, parsed.data.confirmation);
    // PBKDF2 completes before opening the transaction. User + activation writes
    // remain atomic while no transaction waits on CPU-bound hashing.
    const passwordHash = hashPassword(parsed.data.password);
    const activated = await prisma.$transaction((tx) => consumePlatformActivation(tx, {
      token: parsed.data.token,
      passwordHash,
    }));
    const session = await createUserSession({ userId: activated.userId });
    return setAgentSessionCookie(
      noStoreJson({ ok: true, redirectTo: "/platform-admin" }),
      session,
    );
  } catch (error) {
    if (error instanceof PlatformActivationError) {
      return noStoreJson({ error: error.message }, { status: error.status });
    }
    return invalidActivationResponse();
  }
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
