import { createHash } from "node:crypto";

export type MigrationTarget = {
  database: string;
  fingerprint: string;
};

export type MigrationChecksum = {
  migration: string;
  sha256: string;
};

export const RELEASE_GATE_A_MIGRATION_CHECKSUMS: Readonly<Record<string, string>> = {
  "20260713000000_baseline": "420fa8e66fd5211c3725c6d1870e991482f79596bc2edd9cc34e16f92d6b93b3",
  "20260714090000_week2_canonical_case": "04a60742e28be9a628e7085007cb3a222c373539dc8018eab447900103c4a0b8",
  "20260718090000_m1_operations_control_plane": "04aed4c1b9f261a6ef49f239255257cb8343fde753c13af3e75631c63342906e",
  "20260719190000_m1_operations_integrity": "f1e3d1e2201230473ef838b00f61b3e4783d8eeae396d3aec97d783c6c06cb2d",
  "20260726090000_m2_platform_admin_rbac": "9682dcecfdbdd9636a8119d5281d2fe84a8d8973be09955e02838925e5e09a49",
  "20260726150000_m2_platform_admin_activation": "be21b0965b44cc187d2a04385e5f61947d80a399a25ccc8b5f7127ddb6a21449",
  "20260728120000_m2_platform_admin_mfa": "740fb5acc9962622c73af70dc8b3ec9a8213f5932b5f2ab88959447bc70ba70c",
  "20260728130000_m2_platform_admin_activation_revoke": "743d6b48f5c750e2c227fa788e001d3779a867ebfd4f4a71356a771c214ac252",
  "20260728190000_m1_platform_owner_recovery": "352bce3b68654db2d56b5cfff48de6522319cd4f8c96d6376a5bacf6a1b79cbe",
  "20260729170000_m2_commercial_trust_loop": "fc82c99f3fa06cd7a74d42917e82638923d543bb19b5150a1a9403183eb6999e",
  "20260811172829_m3_fulfilment_money_trust": "316b8cffdd44bbe0e9d048664a2d9e1c382f46f65fb9d381803331504e1c8016",
};

export function inspectDirectMigrationUrl(value: string | undefined): MigrationTarget {
  if (!value) throw new Error("DATABASE_URL_UNPOOLED is required");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL_UNPOOLED is not a valid URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL_UNPOOLED must use PostgreSQL");
  }

  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database) throw new Error("Direct migration URL must include host and database");
  if (url.hostname.toLowerCase().includes("pooler") || port === "6543" || url.searchParams.get("pgbouncer") === "true") {
    throw new Error("DATABASE_URL_UNPOOLED points to a pooler");
  }

  const normalized = `${url.hostname.toLowerCase()}:${port}/${database}`;
  return {
    database,
    fingerprint: createHash("sha256").update(normalized).digest("hex").slice(0, 16),
  };
}

export function assertExpectedMigrationTarget(target: MigrationTarget, expected: string | undefined): void {
  if (!expected || !/^[a-f0-9]{16}$/.test(expected)) {
    throw new Error("EXPECTED_DATABASE_FINGERPRINT must be a reviewed 16-character SHA-256 prefix");
  }
  if (target.fingerprint !== expected) throw new Error("Migration target fingerprint mismatch");
}

export function assertApprovedMigrationChecksums(checksums: MigrationChecksum[]): void {
  const actual = new Map(checksums.map((item) => [item.migration, item.sha256]));
  const approvedNames = Object.keys(RELEASE_GATE_A_MIGRATION_CHECKSUMS);
  if (actual.size !== approvedNames.length) throw new Error("Migration set differs from Release Gate A approval");
  for (const name of approvedNames) {
    if (actual.get(name) !== RELEASE_GATE_A_MIGRATION_CHECKSUMS[name]) {
      throw new Error(`Migration checksum mismatch: ${name}`);
    }
  }
}
