import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import {
  issueM3ReviewerAuthorityGrant,
  M3ReviewerAuthorityGrantInput,
} from "@/lib/m3ReviewerCredential";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleM3ReviewerAuthorityGrant(req);
}

export async function handleM3ReviewerAuthorityGrant(
  req: Request,
  rateLimiter = enforcePersistentRateLimit,
) {
  try {
    const limited = await rateLimiter(req, "m3-reviewer-authority-grant", 5, 15 * 60_000);
    if (limited) return limited;
    const context = await requirePlatformAdmin(req);
    const parsed = M3ReviewerAuthorityGrantInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Некорректная цель reviewer authority grant");
    const grant = await prisma.$transaction((tx) => issueM3ReviewerAuthorityGrant(tx, context, parsed.data));
    const response = NextResponse.json({
      authorityGrant: grant.token,
      expiresAt: grant.expiresAt.toISOString(),
      auditEventId: grant.auditEventId,
    }, { status: 201 });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return handleApiError(error, "platform/m3-reviewer-authority");
  }
}
