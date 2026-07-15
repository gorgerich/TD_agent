import assert from "node:assert/strict";
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
