# Isolated Preview evidence

- Runtime implementation SHA: `b72c0eae5a4dd92ec772b97922f5d06209336ced`
- Preview URL:
  `https://td-agent-i86b68ewo-rics-projects-9baa2793.vercel.app`
- Deployment ID: `dpl_J2kE6aHbzwTGMR1BzaHXUgd8jgeG`
- Deployment target/state: `preview` / `READY`
- GitHub deployment SHA: `b72c0eae5a4dd92ec772b97922f5d06209336ced`
- Preview DB fingerprint: `1645948702f70ded`
- Production DB fingerprint: `0257665af2dd90a4`
- Normalized endpoints and fingerprints differ.
- `PREVIEW_DB_ISOLATION`: PASS
- Activation migration applied as the sixth migration on the isolated DB.
- Repeated deploy: PASS, no pending migrations.
- Schema parity: PASS, no difference detected.
- Full local browser UAT against the isolated Preview DB:
  Platform SUPER_ADMIN, Organization ADMIN, MANAGER forbidden, AGENT forbidden,
  cross-tenant isolation, desktop and mobile: PASS.
- First-owner browser UAT on an isolated local PostgreSQL:
  fragment removal, server verification, password setup, automatic session,
  `/platform-admin` redirect, mobile layout and replay rejection: PASS.
- Exact protected Preview `/setup/platform-admin` GET through authenticated
  `vercel curl`: `200`. Temporary project link matched the existing project/team
  IDs and was removed.
- Authenticated deployment smoke through Vercel protection:
  Platform SUPER_ADMIN `200`, Organization ADMIN `200`, MANAGER/AGENT platform
  and team APIs `403`, second organization restricted to its own tenant.
- Public/protected read-only smoke: login `200`, root `307`, unauthenticated
  platform page `307`, protected APIs `401`, unexpected `5xx`: `0`.
- Synthetic fixture cleanup: PASS, organizations/users/memberships/audit residue
  all `0`; temporary passwords, cookies and Vercel link removed.
- Production DB used or changed: NO.

Final implementation CI for this runtime SHA:
https://github.com/gorgerich/TD_agent/actions/runs/30203838837
