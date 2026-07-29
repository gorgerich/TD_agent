# M1 RBAC Hardening release status

State: `RELEASED`

- Product PR: https://github.com/gorgerich/TD_agent/pull/24
- Controlled recovery PR:
  https://github.com/gorgerich/TD_agent/pull/25
- Recovery implementation:
  `934e7ff7ae82925418dfce588004a11fd0b080df`.
- Recovery CI:
  `https://github.com/gorgerich/TD_agent/actions/runs/30451594365`, PASS,
  skipped `0`.
- Recovery Preview: `dpl_GMps7voq6UFYGLt262fsFe1YxPj3`, READY, exact
  implementation SHA.
- Owner release authorization: granted for one controlled release.
- Production migration: PASS, five migrations applied by this release, nine
  total applied migrations, zero failed.
- Production deployment: READY on final runtime SHA
  `d594ad21a5f2d07cea57a2d3355f7190c43e81a5`.
- Final production deployment: `dpl_CdK4ZkoJaEMesGqdMGSCaN6uw9v5`.
- Final main CI:
  `https://github.com/gorgerich/TD_agent/actions/runs/30454919991`, PASS,
  skipped `0`.
- Platform owner password recovery and mandatory TOTP activation: PASS.
- Final `RELEASE_WRITE_FREEZE`: exact `disabled`.
- Runtime implementation:
  `be37d89fc1718744a9aa6896261552f0bd689c35`.
- Authoritative governance-corrected Preview deployment:
  `dpl_5HXCdoQJCKSqy2UxD5YUX23y2Lxy`, target Preview, READY, SHA
  `84ebb8b1ea277f680d8e4848d9cae7d76185420f`.
- Portfolio mission `M2 Commercial Trust Loop`: `NOT_STARTED`.

Authoritative production record:
`docs/evidence/missions/M1-RBAC-HARDENING/post-release.md`.

`RISK-W1-TECH-HUMAN-REVIEW` remains `OPEN`. Portfolio mission
`M2 Commercial Trust Loop` remains `NOT_STARTED`.
