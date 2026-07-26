# Isolated Preview evidence

- Runtime implementation SHA: `fc71780aa6989270ec71065c08f01f3cdf9bafe8`
- Preview URL:
  `https://td-agent-4fslgeqrs-rics-projects-9baa2793.vercel.app`
- Deployment ID: `dpl_2Dqfq9y8kGkYEC8kBvnbioq1SDpd`
- Deployment target/state: `preview` / `READY`
- GitHub deployment SHA: `fc71780aa6989270ec71065c08f01f3cdf9bafe8`
- Preview DB fingerprint: `1645948702f70ded`
- Production DB fingerprint: `0257665af2dd90a4`
- Normalized endpoints and fingerprints differ.
- `PREVIEW_DB_ISOLATION`: PASS
- Migration deploy: five migrations applied on an initially empty isolated DB.
- Repeated deploy: PASS, no pending migrations.
- Schema parity: PASS, no difference detected.
- Full local browser UAT against the isolated Preview DB:
  Platform SUPER_ADMIN, Organization ADMIN, MANAGER forbidden, AGENT forbidden,
  cross-tenant isolation, desktop and mobile: PASS.
- Authenticated deployment smoke through Vercel protection:
  Platform SUPER_ADMIN `200`, Organization ADMIN `200`, MANAGER/AGENT platform
  and team APIs `403`, second organization restricted to its own tenant.
- Public/protected read-only smoke: login `200`, root `307`, unauthenticated
  platform page `307`, protected APIs `401`, unexpected `5xx`: `0`.
- Synthetic fixture cleanup: PASS, organizations/users/memberships/audit residue
  all `0`; temporary passwords, cookies and Vercel link removed.
- Production DB used or changed: NO.

Final CI for this runtime SHA:
https://github.com/gorgerich/TD_agent/actions/runs/30201775441
