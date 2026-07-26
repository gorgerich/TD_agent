# Validation results

Results are refreshed at final branch head before gate closure.

| Gate | Result |
| --- | --- |
| `git diff --check` | PASS |
| Prisma generate | PASS |
| TypeScript | PASS |
| ESLint | PASS |
| Unit | 60 passed, 0 failed, 0 skipped |
| Integration | 36 passed, 0 failed, 0 skipped |
| Migration fixture | PASS |
| Repeated migrate deploy | No pending migrations |
| Build | PASS |
| M2 browser UAT | First-owner activation, Platform Admin, Organization Admin, Manager/Agent forbidden, cross-tenant, mobile: PASS |
| UTC hydration regression | PASS; browser errors `0` |
| GitHub Quality | PASS, run `30203838837`, skipped `0` |
| Vercel protected role smoke | PASS; role redirects/403 and tenant isolation verified |
| Preview fixture residue | `0` |

Final CI and isolated Preview references are recorded in `preview.md`.
