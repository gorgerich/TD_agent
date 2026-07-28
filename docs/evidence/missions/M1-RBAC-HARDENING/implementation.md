# M1 RBAC Hardening implementation

This record covers supplemental hardening of released M1 and Week 8. Its
authoritative mission ID is `M1-RBAC-HARDENING`. It is not the portfolio
mission `M2 Commercial Trust Loop`, which remains `NOT_STARTED`.

- Base: `7e305d28d2a1c15a147a712062f30323acde98c1`
- Runtime implementation:
  `be37d89fc1718744a9aa6896261552f0bd689c35`
- Evidence head before governance correction:
  `785d8242c7cdde9f5d8e771f074b5e391eb0f90b`
- PR: https://github.com/gorgerich/TD_agent/pull/24
- Runtime CI baseline: https://github.com/gorgerich/TD_agent/actions/runs/30349079932
- Final pre-correction evidence CI:
  https://github.com/gorgerich/TD_agent/actions/runs/30350985936
- Authoritative pre-correction Preview:
  https://td-agent-3rd0n1fyt-rics-projects-9baa2793.vercel.app
- Authoritative pre-correction Preview deployment:
  `dpl_2E2VEv2Latm69oFw6a4QzK1v8jHQ`
- Preview deployment SHA:
  `785d8242c7cdde9f5d8e771f074b5e391eb0f90b`
- Validation database fingerprint: `76ecfdc12aece957`

Implemented scope:

- independent platform and organization roles;
- platform-only authenticated session;
- server-side platform and tenant capability guards;
- protected Platform Admin workspace;
- organization team and invitation administration;
- additive organization suspension and audit models;
- trusted SUPER_ADMIN bootstrap;
- hash-only, one-time first-admin activation;
- mandatory TOTP MFA for every SUPER_ADMIN;
- session-version revocation on platform-role elevation and explicit revoke;
- persistent database-backed rate limiting for activation and MFA enrollment;
- fragment-only invitation bearer transport;
- Agent and Manager regression coverage.

Production remained unchanged.
