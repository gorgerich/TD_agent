import { constants } from "node:fs";
import { access, chmod, open, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildPlatformOwnerRecoveryUrl,
  issuePlatformOwnerRecovery,
  revokePlatformOwnerRecovery,
} from "../../lib/platformOwnerRecovery";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";

const email = process.env.PLATFORM_OWNER_EMAIL;
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const confirmation = process.env.CONFIRM_PLATFORM_OWNER_RECOVERY;
const outputConfirmed = process.env.CONFIRM_PLATFORM_OWNER_RECOVERY_OUTPUT === "YES";
const outputFile = process.env.PLATFORM_OWNER_RECOVERY_OUTPUT_FILE;
const runningInCi = Boolean(process.env.CI);
const target = inspectDirectMigrationUrl(directUrl);

if (!email) throw new Error("PLATFORM_OWNER_EMAIL is required");
if (confirmation !== "YES") throw new Error("CONFIRM_PLATFORM_OWNER_RECOVERY=YES is required");
if (!outputConfirmed) throw new Error("CONFIRM_PLATFORM_OWNER_RECOVERY_OUTPUT=YES is required");
if (runningInCi) throw new Error("Platform owner recovery output is blocked in CI");
if (!outputFile || !isAbsolute(outputFile)) {
  throw new Error("PLATFORM_OWNER_RECOVERY_OUTPUT_FILE must be an absolute protected path");
}
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);

const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  let issued: Awaited<ReturnType<typeof issuePlatformOwnerRecovery>> | undefined;
  try {
    await assertProtectedOutputTarget(outputFile!);
    const identity = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (identity.length !== 1 || identity[0].database !== target.database || identity[0].readOnly !== "off") {
      throw new Error("Recovery target identity is not writable or does not match the reviewed endpoint");
    }

    issued = await db.$transaction((tx) => issuePlatformOwnerRecovery(tx, email!));
    const recoveryUrl = buildPlatformOwnerRecoveryUrl(
      issued.token,
      process.env.PLATFORM_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    );
    try {
      const file = await open(outputFile!, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try {
        await file.writeFile(`${recoveryUrl}\n`, { encoding: "utf8" });
        await file.sync();
      } finally {
        await file.close();
      }
      await chmod(outputFile!, 0o600);
    } catch (error) {
      await db.$transaction((tx) => revokePlatformOwnerRecovery(tx, issued!.activationId, issued!.userId));
      throw error;
    }

    process.stdout.write(`${JSON.stringify({
      status: "RECOVERY_READY",
      email: issued.email,
      userId: issued.userId,
      environment: process.env.NODE_ENV ?? "unknown",
      databaseFingerprint: target.fingerprint,
      expiresAt: issued.expiresAt.toISOString(),
      delivery: "LOCAL_0600_FILE",
    })}\n`);
  } finally {
    await db.$disconnect();
  }
}

async function assertProtectedOutputTarget(path: string) {
  await access(dirname(path), constants.W_OK);
  const parent = await stat(dirname(path));
  if ((parent.mode & 0o077) !== 0) {
    throw new Error("Recovery output directory must not be accessible by group or others");
  }
  try {
    await access(path, constants.F_OK);
    throw new Error("Recovery output file already exists");
  } catch (error) {
    if (error instanceof Error && error.message === "Recovery output file already exists") throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Platform owner recovery failed"}\n`);
  process.exitCode = 1;
});
