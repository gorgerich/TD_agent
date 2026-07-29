# Validation results

Results are refreshed at final branch head before gate closure.

| Gate | Result |
| --- | --- |
| `git diff --check` | PASS |
| Prisma generate | PASS |
| TypeScript | PASS |
| ESLint | PASS |
| Unit | 67 passed, 0 failed, 0 skipped |
| Integration | 39 passed, 0 failed, 0 skipped |
| Migration fixture | PASS |
| Repeated migrate deploy | No pending migrations |
| Build | PASS |
| M1 RBAC Hardening browser UAT | First-owner activation, owner recovery, Platform Admin, Organization Admin, Manager/Agent forbidden, cross-tenant, mobile: PASS |
| UTC hydration regression | PASS; browser errors `0` |
| GitHub Quality | PASS, run `30449276195`, skipped `0` |
| Vercel protected role smoke | PASS; role redirects/403 and tenant isolation verified |
| Preview fixture residue | `0` |

Authoritative and historical Preview references are classified in `preview.md`.
Independent owner-recovery review: P0 `0`, P1 `0`.
