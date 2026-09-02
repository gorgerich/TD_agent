import { PrismaClient } from "@prisma/client";
import {
  registerM3ReviewerCredential,
  revokeM3ReviewerCredential,
  runM3ReviewerCredentialTransaction,
} from "../../lib/m3ReviewerCredential";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import { readSecureOperatorFile } from "../../lib/secureOperatorFile";

if (process.env.CI) throw new Error("M3 reviewer credential management is blocked in CI");
if (process.env.CONFIRM_M3_REVIEWER_CREDENTIAL !== "YES") {
  throw new Error("CONFIRM_M3_REVIEWER_CREDENTIAL=YES is required");
}
if (process.env.CONFIRM_M3_REVIEWER_IDENTITY_VERIFIED !== "YES") {
  throw new Error("CONFIRM_M3_REVIEWER_IDENTITY_VERIFIED=YES is required");
}
const action = process.argv[2];
if (action !== "register" && action !== "revoke") {
  throw new Error("Usage: pnpm ops:m3-reviewer-credential -- register|revoke");
}
const authorityGrantFile = process.env.M3_REVIEWER_CREDENTIAL_AUTHORITY_GRANT_FILE ?? "";
if (!authorityGrantFile) throw new Error("M3_REVIEWER_CREDENTIAL_AUTHORITY_GRANT_FILE is required");
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  let authorityGrantToken = "";
  try {
    authorityGrantToken = await readSecureOperatorFile(
      authorityGrantFile,
      "M3 reviewer authority grant",
    );
    const registrationInput = action === "register" ? await readRegistrationInput() : null;
    const revocation = action === "revoke" ? readRevocationInput() : null;
    const [identity] = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (!identity || identity.database !== target.database || identity.readOnly !== "off") {
      throw new Error("M3 reviewer credential target is not writable or does not match reviewed endpoint");
    }
    const result = await runM3ReviewerCredentialTransaction(db, async (tx) => {
      if (action === "register") {
        return registerM3ReviewerCredential(tx, authorityGrantToken, registrationInput);
      }
      if (!revocation) throw new Error("M3 reviewer revocation input is unavailable");
      return revokeM3ReviewerCredential(tx, authorityGrantToken, revocation.keyFingerprint, revocation.reasonCode);
    });
    process.stdout.write(`${JSON.stringify({
      status: result.replayed ? "ALREADY_APPLIED" : "APPLIED",
      action: action.toUpperCase(),
      environment: process.env.NODE_ENV ?? "unknown",
      databaseFingerprint: target.fingerprint,
      keyFingerprint: result.keyFingerprint,
      auditEventId: result.auditEventId,
      occurredAt: ("registeredAt" in result ? result.registeredAt : result.revokedAt).toISOString(),
      replayed: result.replayed,
    })}\n`);
  } finally {
    authorityGrantToken = "";
    await db.$disconnect();
  }
}

async function readRegistrationInput(): Promise<unknown> {
  const inputFile = process.env.M3_REVIEWER_CREDENTIAL_FILE;
  if (!inputFile) throw new Error("M3_REVIEWER_CREDENTIAL_FILE is required for register");
  return JSON.parse(await readSecureOperatorFile(inputFile, "M3 reviewer credential input"));
}

function readRevocationInput() {
  const keyFingerprint = process.env.M3_REVIEWER_KEY_FINGERPRINT;
  const reasonCode = process.env.M3_REVIEWER_REVOCATION_REASON;
  if (!keyFingerprint) throw new Error("M3_REVIEWER_KEY_FINGERPRINT is required for revoke");
  if (!isRevocationReason(reasonCode)) throw new Error("M3_REVIEWER_REVOCATION_REASON is invalid");
  return { keyFingerprint, reasonCode };
}

function isRevocationReason(value: string | undefined): value is
  | "CREDENTIAL_COMPROMISED"
  | "REVIEWER_OFFBOARDED"
  | "ROTATED"
  | "OTHER_APPROVED" {
  return ["CREDENTIAL_COMPROMISED", "REVIEWER_OFFBOARDED", "ROTATED", "OTHER_APPROVED"].includes(value ?? "");
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "M3 reviewer credential operation failed"}\n`);
  process.exitCode = 1;
});
