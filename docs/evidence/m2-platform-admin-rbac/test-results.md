# Validation results

Results are refreshed at final branch head before gate closure.

| Gate | Result |
| --- | --- |
| `git diff --check` | PASS |
| Prisma generate | PASS |
| TypeScript | PASS |
| ESLint | PASS |
| Unit | 58 passed, 0 failed, 0 skipped |
| Integration | 35 passed, 0 failed, 0 skipped |
| Migration fixture | PASS |
| Repeated migrate deploy | No pending migrations |
| Build | PASS |
| M2 browser UAT | Platform Admin, Organization Admin, Manager/Agent forbidden, cross-tenant, mobile: PASS |

Final CI and isolated Preview references are recorded in `preview.md`.
