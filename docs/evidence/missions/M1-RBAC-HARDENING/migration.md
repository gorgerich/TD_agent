# Platform Admin RBAC migration evidence

Migrations:

- `20260726090000_m2_platform_admin_rbac`
- `20260726150000_m2_platform_admin_activation`
- `20260728120000_m2_platform_admin_mfa`
- `20260728130000_m2_platform_admin_activation_revoke`

Safety:

- additive only;
- isolated validation database fingerprint: `76ecfdc12aece957`;
- confirmed different from Production fingerprint;
- initial deploy: PASS;
- repeated deploy: no-op;
- schema parity: PASS;
- existing migration checksums unchanged;
- fixture residue after verification: `0`;
- pre-existing open activation records without an MFA secret are revoked by a
  separate additive repair migration;
- `20260728120000_m2_platform_admin_mfa` checksum remains
  `740fb5acc9962622c73af70dc8b3ec9a8213f5932b5f2ab88959447bc70ba70c`;
- `20260728130000_m2_platform_admin_activation_revoke` checksum is
  `743d6b48f5c750e2c227fa788e001d3779a867ebfd4f4a71356a771c214ac252`;
- Production migration: not performed;
- Production schema changes: none.
