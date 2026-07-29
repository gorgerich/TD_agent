# M1 RBAC Hardening implementation

This record covers supplemental hardening of released M1 and Week 8. Its
authoritative mission ID is `M1-RBAC-HARDENING`. It is not the portfolio
mission `M2 Commercial Trust Loop`, which remains `NOT_STARTED`.

- Base: `7e305d28d2a1c15a147a712062f30323acde98c1`
- Runtime implementation:
  `be37d89fc1718744a9aa6896261552f0bd689c35`
- Evidence head before governance correction:
  `785d8242c7cdde9f5d8e771f074b5e391eb0f90b`
- Governance correction SHA:
  `84ebb8b1ea277f680d8e4848d9cae7d76185420f`
- PR: https://github.com/gorgerich/TD_agent/pull/24
- Runtime CI baseline: https://github.com/gorgerich/TD_agent/actions/runs/30349079932
- Governance correction CI:
  https://github.com/gorgerich/TD_agent/actions/runs/30353147176
- Authoritative governance-corrected Preview:
  https://td-agent-4u8zb9qz4-rics-projects-9baa2793.vercel.app
- Authoritative governance-corrected Preview deployment:
  `dpl_5HXCdoQJCKSqy2UxD5YUX23y2Lxy`
- Preview deployment SHA:
  `84ebb8b1ea277f680d8e4848d9cae7d76185420f`
- Validation database fingerprint: `76ecfdc12aece957`
- Existing-owner recovery implementation:
  `934e7ff7ae82925418dfce588004a11fd0b080df`
- Recovery PR: https://github.com/gorgerich/TD_agent/pull/25
- Recovery CI:
  https://github.com/gorgerich/TD_agent/actions/runs/30451594365
- Recovery Preview:
  https://td-agent-qtgtjspiv-rics-projects-9baa2793.vercel.app
- Recovery Preview deployment: `dpl_GMps7voq6UFYGLt262fsFe1YxPj3`

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
- purpose-bound, audited existing-owner password recovery with mandatory TOTP;
- transaction-bound session rotation and persistent recovery rate limiting;
- exact freeze exception limited to the controlled recovery endpoint.
- restored-snapshot-safe smoke-account test identity and exact cleanup.

Production remained unchanged by this implementation/evidence candidate.
