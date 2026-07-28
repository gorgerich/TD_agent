import { PrismaClient } from "@prisma/client";
import { bootstrapPlatformSuperAdmin } from "../../lib/platformBootstrap";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";

const email = process.env.PLATFORM_SUPER_ADMIN_EMAIL;
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const confirmation = process.env.CONFIRM_PLATFORM_ADMIN_BOOTSTRAP;
const activationOutputConfirmed = process.env.CONFIRM_PLATFORM_ADMIN_ACTIVATION_OUTPUT === "YES";
const runningInCi = Boolean(process.env.CI);
const target = inspectDirectMigrationUrl(directUrl);
const activationBaseUrl = activationOutputConfirmed && !runningInCi
  ? validateActivationBaseUrl()
  : undefined;

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
    const result = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, email!, {
      allowActivationOutput: activationOutputConfirmed && !runningInCi,
    }));
    const activationUrl = result.activation
      ? buildActivationUrl(result.activation.token, activationBaseUrl)
      : undefined;
    process.stdout.write(`${JSON.stringify({
      status: result.activation
        ? "ACTIVATION_REQUIRED"
        : result.replayed
          ? "ALREADY_SUPER_ADMIN"
          : "BOOTSTRAPPED",
      email: result.email,
      environment: process.env.NODE_ENV ?? "unknown",
      databaseFingerprint: target.fingerprint,
      userId: result.userId,
      replayed: result.replayed,
      expiresAt: result.activation?.expiresAt.toISOString(),
      activationUrl,
    })}\n`);
  } finally {
    await db.$disconnect();
  }
}

function validateActivationBaseUrl() {
  if (runningInCi) throw new Error("Platform activation output is blocked in CI");
  const configured = process.env.PLATFORM_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? "https://td-agent.vercel.app";
  const base = new URL(configured);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("PLATFORM_BASE_URL must use HTTPS");
  }
  return base;
}

function buildActivationUrl(token: string, base?: URL) {
  if (!base) {
    throw new Error("CONFIRM_PLATFORM_ADMIN_ACTIVATION_OUTPUT=YES is required");
  }
  const url = new URL("/setup/platform-admin", base);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Platform admin bootstrap failed"}\n`);
  process.exitCode = 1;
});
