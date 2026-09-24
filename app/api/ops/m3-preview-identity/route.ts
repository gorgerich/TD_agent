import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inspectDirectMigrationUrl } from "@/lib/migrationTarget";
import { isApprovedM3PreviewDatabase } from "@/lib/m3AuditMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRODUCTION_FINGERPRINT = "0257665af2dd90a4";
const PREVIEW_BRANCH = "mission/m3-fulfilment-money-trust";

function authorized(request: Request): boolean {
  if (process.env.VERCEL_ENV !== "preview"
    || process.env.VERCEL_GIT_COMMIT_REF !== PREVIEW_BRANCH
    || process.env.PREVIEW_DB_ISOLATION !== "PASS") return false;
  const expected = process.env.M3_PREVIEW_DIAGNOSTIC_SECRET;
  const supplied = request.headers.get("x-m3-preview-secret");
  if (!expected || expected.length < 32 || !supplied) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });
  try {
    const direct = inspectDirectMigrationUrl(process.env.DATABASE_URL_UNPOOLED);
    if (direct.fingerprint === PRODUCTION_FINGERPRINT || !isApprovedM3PreviewDatabase()) {
      return NextResponse.json({ isolation: "FAIL" }, { status: 503 });
    }
    const rows = await prisma.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (rows.length !== 1 || rows[0].database !== direct.database || rows[0].readOnly !== "off") {
      return NextResponse.json({ isolation: "FAIL" }, { status: 503 });
    }
    return NextResponse.json({ connection: "PASS", fingerprint: direct.fingerprint }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ isolation: "FAIL" }, { status: 503 });
  }
}
