# M2 release

Production release is outside this mission authority envelope.

- Production writes: none.
- Production schema changes: none.
- Production deployment: unchanged.
- Owner release authorization: required after `MISSION_RELEASE_READY`.

Status: `IMPLEMENTATION_VERIFIED` at `60d00f67233c65eaedabadf9393f6185626d7a9a`.

`MISSION_RELEASE_READY` is not reachable from an implementation session: it needs
`preview_uat` (a Preview deployment of the exact SHA) and `independent_review`
(P0 = 0 and P1 = 0 from someone other than the implementer). Both are recorded as
open blockers in `mission.yaml`.
