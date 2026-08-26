import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  activateM3ApprovedPoliciesAndMaterializeExistingCases,
  parseM3ApprovedPolicyBundle,
} from "../../lib/m3PolicyActivation";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";

if (process.env.CI) throw new Error("M3 human-approved policy activation is blocked in CI");
if (process.env.CONFIRM_M3_POLICY_APPLY !== "YES") throw new Error("CONFIRM_M3_POLICY_APPLY=YES is required");
if (process.env.CONFIRM_M3_HUMAN_ATTESTATIONS !== "YES") {
  throw new Error("CONFIRM_M3_HUMAN_ATTESTATIONS=YES is required");
}
const policyFile = process.env.M3_APPROVED_POLICY_FILE;
if (!policyFile) throw new Error("M3_APPROVED_POLICY_FILE is required");
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
const bundle = parseM3ApprovedPolicyBundle(JSON.parse(await readFile(policyFile, "utf8")));
const approvalExpectation = {
  previewUrl: requiredEnv("EXPECTED_M3_PREVIEW_URL"),
  deploymentId: requiredEnv("EXPECTED_M3_RELEASE_DEPLOYMENT_ID"),
  implementationSha: requiredEnv("EXPECTED_M3_IMPLEMENTATION_SHA"),
  databaseFingerprint: requiredEnv("EXPECTED_M3_PREVIEW_DATABASE_FINGERPRINT"),
  bundleFingerprint: requiredEnv("EXPECTED_M3_POLICY_BUNDLE_FINGERPRINT"),
  financeAttestationFingerprint: requiredEnv("EXPECTED_M3_FINANCE_ATTESTATION_FINGERPRINT"),
  legalPrivacyAttestationFingerprint: requiredEnv("EXPECTED_M3_LEGAL_PRIVACY_ATTESTATION_FINGERPRINT"),
  ritualSmeAttestationFingerprint: requiredEnv("EXPECTED_M3_RITUAL_SME_ATTESTATION_FINGERPRINT"),
};
const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  try {
    const [identity] = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (!identity || identity.database !== target.database || identity.readOnly !== "off") {
      throw new Error("M3 policy target is not writable or does not match reviewed endpoint");
    }
    const commandRunId = randomUUID();
    const result = await db.$transaction((tx) => (
      activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        bundle,
        approvalExpectation,
        commandRunId,
      )
    ));
    process.stdout.write(`${JSON.stringify({
      status: result.replayed ? "ALREADY_APPLIED" : "APPLIED",
      environment: process.env.NODE_ENV ?? "unknown",
      databaseFingerprint: target.fingerprint,
      organizationId: bundle.organizationId,
      bundleFingerprint: result.bundleFingerprint,
      replayed: result.replayed,
      materialization: result.materialization,
    })}\n`);
  } finally {
    await db.$disconnect();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "M3 policy activation failed"}\n`);
  process.exitCode = 1;
});
