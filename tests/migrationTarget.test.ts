import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertApprovedMigrationChecksums,
  assertExpectedMigrationTarget,
  RELEASE_GATE_A_MIGRATION_CHECKSUMS,
  inspectDirectMigrationUrl,
} from "../lib/migrationTarget";

test("migration target fingerprint normalizes default port and query parameters", () => {
  const first = inspectDirectMigrationUrl("postgresql://db.example.test:5432/app?sslmode=require");
  const second = inspectDirectMigrationUrl("postgresql://db.example.test/app?connect_timeout=5");
  assert.equal(first.database, "app");
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.fingerprint.length, 16);
});

test("migration target rejects poolers and non-PostgreSQL URLs", () => {
  assert.throws(() => inspectDirectMigrationUrl("postgresql://db-pooler.example.test/app"), /pooler/);
  assert.throws(() => inspectDirectMigrationUrl("postgresql://db.example.test:6543/app"), /pooler/);
  assert.throws(() => inspectDirectMigrationUrl("postgresql://db.example.test/app?pgbouncer=true"), /pooler/);
  assert.throws(() => inspectDirectMigrationUrl("https://db.example.test/app"), /PostgreSQL/);
});

test("migration target requires exact reviewed fingerprint", () => {
  const target = inspectDirectMigrationUrl("postgresql://db.example.test/app");
  assert.doesNotThrow(() => assertExpectedMigrationTarget(target, target.fingerprint));
  assert.throws(() => assertExpectedMigrationTarget(target, "0000000000000000"), /mismatch/);
  assert.throws(() => assertExpectedMigrationTarget(target, undefined), /reviewed/);
});

// Drift guard: hash the real migration.sql files on disk instead of echoing the approved
// constant back at itself. Without this, the approval registry could silently diverge from
// the migrations it claims to approve — a new migration could ship entirely unlisted — and
// every other test here would still pass, because both sides of the comparison came from
// one source. This detects drift; it is not a control against a malicious author, who can
// edit the registry and the migration in the same commit.
test("approved checksums match the migration files actually on disk", () => {
  const root = path.join(process.cwd(), "prisma", "migrations");
  const onDisk = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((migration) => ({
      migration,
      sha256: createHash("sha256").update(readFileSync(path.join(root, migration, "migration.sql"))).digest("hex"),
    }));

  assert.deepEqual(
    onDisk.map((item) => item.migration),
    Object.keys(RELEASE_GATE_A_MIGRATION_CHECKSUMS).sort(),
    "every migration directory must be listed in RELEASE_GATE_A_MIGRATION_CHECKSUMS (and vice versa)",
  );
  for (const item of onDisk) {
    assert.equal(
      RELEASE_GATE_A_MIGRATION_CHECKSUMS[item.migration],
      item.sha256,
      `approved checksum for ${item.migration} does not match its migration.sql on disk`,
    );
  }
  assert.doesNotThrow(() => assertApprovedMigrationChecksums(onDisk));
});

test("migration checksum guard rejects missing, extra and modified files", () => {
  const approved = Object.entries(RELEASE_GATE_A_MIGRATION_CHECKSUMS).map(([migration, sha256]) => ({ migration, sha256 }));
  assert.doesNotThrow(() => assertApprovedMigrationChecksums(approved));
  assert.throws(() => assertApprovedMigrationChecksums(approved.slice(1)), /differs/);
  assert.throws(
    () => assertApprovedMigrationChecksums([...approved, { migration: "unexpected", sha256: "0".repeat(64) }]),
    /differs/,
  );
  assert.throws(
    () => assertApprovedMigrationChecksums(approved.map((item, index) => index === 0 ? { ...item, sha256: "0".repeat(64) } : item)),
    /checksum mismatch/,
  );
});
