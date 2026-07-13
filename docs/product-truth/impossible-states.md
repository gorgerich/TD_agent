# Impossible-state matrix

These acceptance IDs describe required behavior. The pure executable specification is
`tests/productTruth.test.ts`. Runtime owners must replace spec-only coverage with
integration/e2e proof in the scheduled implementation week.

| Test ID | Impossible state observed in audit | Expected behavior | Future owner |
| --- | --- | --- | --- |
| `PT-001` | Unsaved agent draft changes client co-view | Client reads only current published immutable version | Week 3 quote owner |
| `PT-002` | “Price on request” becomes `0 ₽` | Unknown price remains unknown and blocks publish | Week 3 quote/catalog owner |
| `PT-003` | Estimate list total differs from opened builder | Every surface projects the same quote/version ID | Week 3 quote owner |
| `PT-004` | Publishing/sending quote leaves send task open | Event closes exactly one projected task idempotently | Week 2 event/task owner |
| `PT-005` | `88 000 ₽` advance marks `176 000 ₽` obligation paid | Derived state is `PARTIALLY_PAID` | Week 6 finance owner |
| `PT-006` | Payment row can be deleted | Correction appends reversal; original entry remains | Week 6 finance owner |
| `PT-007` | Document counts/readiness disagree | Readiness uses requirements and verified versions only | Week 7 document owner |
| `PT-008` | Unknown cost becomes zero and creates false margin | Margin is unknown until cost is known | Week 3/6 economics owner |
| `PT-009` | Past meeting remains scheduled forever | Deadline creates escalation/outcome task once | Week 2 meeting owner |
| `PT-010` | UI-derived stage bypasses scenario guards | Canonical transition service rejects missing guards | Week 2 case owner |
| `PT-011` | Mutation lacks actor/tenant/correlation identity | Canonical event envelope requires all audit fields | Week 2 platform owner |

## Stop condition

Any occurrence of `PT-001`, `PT-002`, `PT-005`, `PT-006`, cross-tenant access or data
loss in pilot data blocks rollout. Visual polish cannot waive this condition.
