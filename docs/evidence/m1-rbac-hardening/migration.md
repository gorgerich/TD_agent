# M1 RBAC Hardening migration evidence

Migration:

- `20260726090000_m2_platform_admin_rbac`
- SHA-256: `9682dcecfdbdd9636a8119d5281d2fe84a8d8973be09955e02838925e5e09a49`
- `20260726150000_m2_platform_admin_activation`
- SHA-256: `be21b0965b44cc187d2a04385e5f61947d80a399a25ccc8b5f7127ddb6a21449`
- `20260728190000_m1_platform_owner_recovery`
- SHA-256: `352bce3b68654db2d56b5cfff48de6522319cd4f8c96d6376a5bacf6a1b79cbe`
- Type: additive

Changes:

- adds `PlatformRole`;
- adds `OrganizationStatus`;
- adds `User.platformRole` with `USER` default;
- adds `Organization.status` with `ACTIVE` default;
- creates `PlatformAuditEvent` and supporting indexes/FK.
- creates `PlatformAccountActivation`, unique token-hash index, expiry/user
  indexes and cascading User FK.
- adds purpose-bound first-access and owner-recovery activation records and a
  supporting purpose index.

Isolated Preview:

- migration deploy: PASS;
- owner-recovery migration deploy: PASS;
- repeated deploy: no pending migrations;
- schema parity: PASS;
- baseline Organization/Membership/Case/Task/PlatformAccountActivation counts:
  all 0.

Existing approved migration files are unchanged:

- Week 1 baseline:
  `420fa8e66fd5211c3725c6d1870e991482f79596bc2edd9cc34e16f92d6b93b3`
- Week 2 canonical case:
  `04a60742e28be9a628e7085007cb3a222c373539dc8018eab447900103c4a0b8`
- M1 control plane:
  `04aed4c1b9f261a6ef49f239255257cb8343fde753c13af3e75631c63342906e`
- M1 integrity:
  `f1e3d1e2201230473ef838b00f61b3e4783d8eeae396d3aec97d783c6c06cb2d`

Production migration:

- status: PASS on 2026-07-29;
- target fingerprint: `0257665af2dd90a4`;
- duration: 15 seconds;
- total applied migrations after release: 9;
- failed or incomplete migrations: 0;
- repeated deploy: no-op;
- schema parity: PASS;
- legacy counts, tenant integrity, duplicates, orphans and reconciliation: PASS.
