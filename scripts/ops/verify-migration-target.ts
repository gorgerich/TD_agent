import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  assertApprovedMigrationChecksums,
  assertExpectedMigrationTarget,
  inspectDirectMigrationUrl,
} from "../../lib/migrationTarget";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required by Prisma configuration");
  const directUrl = process.env.DATABASE_URL_UNPOOLED;
  const target = inspectDirectMigrationUrl(directUrl);
  assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);

  const db = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    const identity = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
      SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (identity.length !== 1 || identity[0].database !== target.database) {
      throw new Error("Connected database identity does not match direct URL");
    }
    if (identity[0].readOnly !== "off") throw new Error("Migration target is read-only");
  } finally {
    await db.$disconnect();
  }

  const checksums = await migrationChecksums(path.join(process.cwd(), "prisma", "migrations"));
  assertApprovedMigrationChecksums(checksums);
  process.stdout.write(`${JSON.stringify({ targetFingerprint: target.fingerprint, checksums })}\n`);
}

async function migrationChecksums(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const results: Array<{ migration: string; sha256: string }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "migration.sql");
    const contents = await readFile(file);
    results.push({ migration: entry.name, sha256: createHash("sha256").update(contents).digest("hex") });
  }
  if (results.length === 0) throw new Error("No migration.sql files found in current checkout");
  return results;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Migration target verification failed"}\n`);
  process.exitCode = 1;
});
