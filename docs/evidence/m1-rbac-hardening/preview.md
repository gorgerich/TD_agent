# M1 RBAC Hardening Preview evidence

## Authoritative owner-recovery release candidate

- Recovery implementation SHA:
  `934e7ff7ae82925418dfce588004a11fd0b080df`
- Preview URL:
  `https://td-agent-qtgtjspiv-rics-projects-9baa2793.vercel.app`
- Deployment ID: `dpl_GMps7voq6UFYGLt262fsFe1YxPj3`
- Deployment target/state: `preview` / `READY`
- Deployment SHA: `934e7ff7ae82925418dfce588004a11fd0b080df`
- Validation database fingerprint: `76ecfdc12aece957`
- Exact-head CI:
  `https://github.com/gorgerich/TD_agent/actions/runs/30451594365`
- CI result: PASS, skipped `0`

This candidate adds controlled existing-owner recovery. Production recovery,
migration and deployment had not been performed at this historical Preview
evidence head. Final Production truth is recorded in
`docs/evidence/missions/M1-RBAC-HARDENING/post-release.md`.

## Historical Preview records

These records remain factual but are superseded as current release-candidate
identity.

### Initial owner-recovery candidate

- Implementation SHA:
  `c735dab4f1de6d1175dc0d53bd1f525c4497c1a0`
- Deployment ID: `dpl_7LJ4w6KirckQ27c4H7AARTcBHeC3`
- Classification: `HISTORICAL_SUPERSEDED`

### Governance-corrected M1 RBAC Hardening candidate

- Runtime implementation SHA:
  `be37d89fc1718744a9aa6896261552f0bd689c35`
- Governance correction SHA:
  `84ebb8b1ea277f680d8e4848d9cae7d76185420f`
- Preview URL:
  `https://td-agent-4u8zb9qz4-rics-projects-9baa2793.vercel.app`
- Deployment ID: `dpl_5HXCdoQJCKSqy2UxD5YUX23y2Lxy`
- Deployment SHA: `84ebb8b1ea277f680d8e4848d9cae7d76185420f`
- Classification: `HISTORICAL_SUPERSEDED`

### Final pre-correction evidence candidate

- Evidence head:
  `785d8242c7cdde9f5d8e771f074b5e391eb0f90b`
- Preview URL:
  `https://td-agent-3rd0n1fyt-rics-projects-9baa2793.vercel.app`
- Deployment ID: `dpl_2E2VEv2Latm69oFw6a4QzK1v8jHQ`
- Deployment SHA: `785d8242c7cdde9f5d8e771f074b5e391eb0f90b`
- Validation database fingerprint: `76ecfdc12aece957`
- Classification: `HISTORICAL_SUPERSEDED`

### Runtime candidate

- Runtime implementation SHA:
  `be37d89fc1718744a9aa6896261552f0bd689c35`
- Preview URL:
  `https://td-agent-3f4oiko7f-rics-projects-9baa2793.vercel.app`
- Deployment ID: `dpl_79EvErGKsU787Su7NAC763q6vpho`
- Validation database fingerprint: `76ecfdc12aece957`
- Classification: `HISTORICAL_SUPERSEDED`

### First-owner activation candidate

- Runtime implementation SHA:
  `b72c0eae5a4dd92ec772b97922f5d06209336ced`
- Preview URL:
  `https://td-agent-i86b68ewo-rics-projects-9baa2793.vercel.app`
- Deployment ID: `dpl_J2kE6aHbzwTGMR1BzaHXUgd8jgeG`
- Deployment target/state: `preview` / `READY`
- Deployment SHA: `b72c0eae5a4dd92ec772b97922f5d06209336ced`
- Historical isolated database fingerprint: `1645948702f70ded`
- Classification: `HISTORICAL_SUPERSEDED`

Historical verification included additive migration deployment, repeated
deploy no-op, schema parity, Platform SUPER_ADMIN and Organization ADMIN flows,
forbidden MANAGER/AGENT access, cross-tenant isolation, first-owner activation,
mobile layout and cleanup with residue `0`.

Production database used or changed by Preview validation: `NO`.
Portfolio mission `M2 Commercial Trust Loop`: `NOT_STARTED`.
