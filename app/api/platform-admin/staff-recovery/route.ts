import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { AuthenticationError } from "@/lib/auth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { issueStaffAccountRecovery, revokeStaffAccountRecovery, StaffAccountRecoveryError, STAFF_RECOVERY_INVALID_MESSAGE } from "@/lib/staffAccountRecovery";
import { isReleaseWriteFreezeActive } from "@/lib/releaseWriteFreeze";
import { commandMetaFromHeaders } from "@/lib/m3Api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Body = z.object({
  organizationId: z.string().min(1).max(200), membershipId: z.string().min(1).max(200),
  reason: z.string().trim().min(3).max(240), confirmation: z.string().max(100),
  recoveryId: z.string().min(1).max(200).optional(),
}).strict();

export async function POST(req: NextRequest) { return handleStaffRecoveryIssuance(req, false); }
export async function DELETE(req: NextRequest) { return handleStaffRecoveryIssuance(req, true); }

export async function handleStaffRecoveryIssuance(req: NextRequest, revoke: boolean,
  limiter = enforcePersistentRateLimit, authenticate = requirePlatformAdmin) {
  try {
    if (isReleaseWriteFreezeActive()) return secure(NextResponse.json({ error: "Изменения временно приостановлены" }, { status: 503 }));
    const actor = await authenticate(req);
    const limited = await limiter(req, "staff-recovery-issue", 5, 15 * 60_000);
    if (limited) return secure(limited);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success || (revoke && !body.data.recoveryId)) return secure(NextResponse.json({ error: "Проверьте данные восстановления" }, { status: 400 }));
    if (revoke) {
      await runOperationalTransaction((tx) => revokeStaffAccountRecovery(tx, actor, { ...body.data, recoveryId: body.data.recoveryId! }));
      return secure(NextResponse.json({ ok: true }));
    }
    const { idempotencyKey } = commandMetaFromHeaders(req);
    const recovery = await runOperationalTransaction((tx) => issueStaffAccountRecovery(tx, actor, { ...body.data, idempotencyKey }));
    return secure(NextResponse.json(recovery, { status: recovery.replayed ? 200 : 201 }));
  } catch (error) {
    if (error instanceof StaffAccountRecoveryError) return secure(NextResponse.json({ error: STAFF_RECOVERY_INVALID_MESSAGE }, { status: 400 }));
    // Do not send Prisma/credential diagnostics through a logging error helper.
    if (error instanceof AuthenticationError || error instanceof OperationalCommandError) {
      return secure(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    return secure(NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503 }));
  }
}

function secure(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
