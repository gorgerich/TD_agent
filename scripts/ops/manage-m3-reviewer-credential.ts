import { lstat, readFile } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  registerM3ReviewerCredential,
  revokeM3ReviewerCredential,
} from "../../lib/m3ReviewerCredential";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";

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
const authoritySessionFile = process.env.M3_REVIEWER_CREDENTIAL_AUTHORITY_SESSION_FILE ?? "";
if (!authoritySessionFile) throw new Error("M3_REVIEWER_CREDENTIAL_AUTHORITY_SESSION_FILE is required");
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  let authoritySessionToken = "";
  try {
    const authorityFile = await lstat(authoritySessionFile);
    if (!authorityFile.isFile() || (authorityFile.mode & 0o777) !== 0o600) {
      throw new Error("M3 reviewer authority session must be a regular file with mode 0600");
    }
    authoritySessionToken = (await readFile(authoritySessionFile, "utf8")).trim();
    if (!authoritySessionToken) throw new Error("M3 reviewer authority session file is empty");
    const [identity] = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (!identity || identity.database !== target.database || identity.readOnly !== "off") {
      throw new Error("M3 reviewer credential target is not writable or does not match reviewed endpoint");
    }
    const result = await db.$transaction(async (tx) => {
      if (action === "register") {
        const inputFile = process.env.M3_REVIEWER_CREDENTIAL_FILE;
        if (!inputFile) throw new Error("M3_REVIEWER_CREDENTIAL_FILE is required for register");
        return registerM3ReviewerCredential(tx, authoritySessionToken, JSON.parse(await readFile(inputFile, "utf8")));
      }
      const keyFingerprint = process.env.M3_REVIEWER_KEY_FINGERPRINT;
      const reasonCode = process.env.M3_REVIEWER_REVOCATION_REASON;
      if (!keyFingerprint) throw new Error("M3_REVIEWER_KEY_FINGERPRINT is required for revoke");
      if (!isRevocationReason(reasonCode)) throw new Error("M3_REVIEWER_REVOCATION_REASON is invalid");
      return revokeM3ReviewerCredential(tx, authoritySessionToken, keyFingerprint, reasonCode);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
    authoritySessionToken = "";
    await db.$disconnect();
  }
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
