# UI status registry

This registry covers every status/filter state rendered by the four Week 1 acceptance
surfaces. “Current derivation” describes audited code, not approved truth. “Target
source” is the only allowed owner after migration.

## `/agent/cases`

| UI keys / labels | Current derivation | Target source / owner |
| --- | --- | --- |
| `new`, `meeting-set` | meeting count/upcoming meeting in `deriveCaseStatus` | CaseProjection from case and meeting events / Case owner |
| `collecting-info`, `preparing` | intake booleans, document count, meeting count | scenario checklist + verified document projection / Case owner |
| `quote-ready`, `quote-sent`, `client-viewing` | quote count, co code, viewed timestamp | published pointer + access/view events / Quote owner |
| `client-agreed` | meeting agreement timestamp | `quote.accepted.v1` / Quote owner |
| `await-payment`, `deposit`, `paid` | `Order.status` string sets | obligation + payment ledger projection / Finance owner |
| `ceremony-scheduled` | paid heuristic + future ceremony date | payment projection + execution schedule events / Case owner |
| `done` | `Order.status === COMPLETED` | guarded `case.closed.v1` / Case owner |
| high/medium/low priority | ceremony time, staleness and derived stage | versioned RiskProjection / Case owner |
| `critical` / Срочное | ceremony is within the configured urgent window | versioned RiskProjection / Case owner |
| `today` / Сегодня | scheduled meeting falls today | MeetingProjection in organization timezone / Meeting owner |
| `awaitClient` / Ждём клиента | `waiting === client` from quote heuristics | Quote access/acceptance projection / Quote owner |
| `awaitPayment` / Ждём оплату | `waiting === payment` from order strings | obligation + payment ledger projection / Finance owner |
| `stale` / Без движения | last derived activity older than seven days | CaseActivityProjection + risk policy / Case owner |
| `progress` / В работе | fallback for active non-waiting case | canonical CaseProjection / Case owner |

## `/agent/estimates`

| UI status | Current derivation | Target source / owner |
| --- | --- | --- |
| `Черновик` | Quote exists without `QuoteVersion` | Quote state `DRAFT` / Quote owner |
| `Отправлена` | latest version exists | current published version pointer + publish event / Quote owner |
| `Согласована` | related Order is not pending/cancelled | `quote.accepted.v1` for exact version / Quote owner |
| total/date/filter counts | latest version by timestamp | explicitly selected draft or current published version ID / QuoteProjection |

## `/agent/tasks`

| UI status/group | Current derivation | Target source / owner |
| --- | --- | --- |
| open/later | `completedAt === null`, due after today | Task state + due projection / Task owner |
| today | open + browser-local date comparison | Task due projection in organization timezone / Task owner |
| overdue | open + `dueAt` before today | Task due projection in organization timezone / Task owner |
| completed | `completedAt !== null` | `task.completed.v1` / Task owner |
| group counts | client-side grouping | same TaskProjection query, no independent formula / Task owner |

## `/agent/documents`

| UI status/filter | Current derivation | Target source / owner |
| --- | --- | --- |
| `Требуется` | missing row from static four-category list | versioned scenario requirement / Document owner |
| `Загружен` | matching `Document` row exists | latest DocumentVersion state `UPLOADED` / Document owner |
| `Готово` | all static categories have uploaded rows | all required latest versions are `VERIFIED` / Document owner |
| required/uploaded/ready counts | page-local reconstruction | one DocumentReadinessProjection for list, case and counters / Document owner |

No label, badge or counter on these routes may derive from seed data or a second local
formula once its canonical projection exists.
