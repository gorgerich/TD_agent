import { PrismaClient } from "@prisma/client";
import { bootstrapPlatformSuperAdmin } from "../../lib/platformBootstrap";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";

const email = process.env.PLATFORM_SUPER_ADMIN_EMAIL;
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const confirmation = process.env.CONFIRM_PLATFORM_ADMIN_BOOTSTRAP;
const target = inspectDirectMigrationUrl(directUrl);

if (!email) throw new Error("PLATFORM_SUPER_ADMIN_EMAIL is required");
if (confirmation !== "YES") throw new Error("CONFIRM_PLATFORM_ADMIN_BOOTSTRAP=YES is required");
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);

const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  try {
    const identity = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (identity.length !== 1 || identity[0].database !== target.database || identity[0].readOnly !== "off") {
      throw new Error("Bootstrap target identity is not writable or does not match the reviewed endpoint");
    }
    const result = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, email!));
    process.stdout.write(`${JSON.stringify({
      status: result.replayed ? "ALREADY_SUPER_ADMIN" : "BOOTSTRAPPED",
      environment: process.env.NODE_ENV ?? "unknown",
      databaseFingerprint: target.fingerprint,
      userId: result.userId,
      replayed: result.replayed,
    })}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Platform admin bootstrap failed"}\n`);
  process.exitCode = 1;
});
