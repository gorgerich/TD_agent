import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { applyM3ApprovedPolicyBundle, parseM3ApprovedPolicyBundle } from "../../lib/m3PolicyActivation";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";

if (process.env.CI) throw new Error("M3 human-approved policy activation is blocked in CI");
if (process.env.CONFIRM_M3_POLICY_APPLY !== "YES") throw new Error("CONFIRM_M3_POLICY_APPLY=YES is required");
const policyFile = process.env.M3_APPROVED_POLICY_FILE;
if (!policyFile) throw new Error("M3_APPROVED_POLICY_FILE is required");
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
const bundle = parseM3ApprovedPolicyBundle(JSON.parse(await readFile(policyFile, "utf8")));
const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  try {
    const [identity] = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (!identity || identity.database !== target.database || identity.readOnly !== "off") {
      throw new Error("M3 policy target is not writable or does not match reviewed endpoint");
    }
    const result = await db.$transaction((tx) => applyM3ApprovedPolicyBundle(tx, bundle));
    process.stdout.write(`${JSON.stringify({
      status: result.replayed ? "ALREADY_APPLIED" : "APPLIED",
      environment: process.env.NODE_ENV ?? "unknown",
      databaseFingerprint: target.fingerprint,
      organizationId: bundle.organizationId,
      bundleFingerprint: result.bundleFingerprint,
      replayed: result.replayed,
    })}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "M3 policy activation failed"}\n`);
  process.exitCode = 1;
});
