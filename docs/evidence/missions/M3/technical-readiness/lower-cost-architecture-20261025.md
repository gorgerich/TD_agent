# Lower-Cost Architecture Comparison: October25

Status: COMPARISON_ONLY_NOT_AUTHORIZED. Research date: 2026-10-25. Authorized incremental spend remains **$0**. No resource, bucket, plan change, migration, deployment, cloud/VM experiment, credential operation or invoice-login request was initiated by this sidecar. Only this document was written. Existing source changes and the parent's scanner investigation are untouched. NOX, B2C and retained restore resources are excluded from reuse or claimed savings.

## Recommendation

For a future cost-first pilot, evaluate ONE lower-cost alternative: TD-only Next.js app and isolated ClamAV gateway as separate Railway services, the existing TD Postgres unchanged, a short-lived Railway cron service, and a private Railway S3-compatible bucket replacing Vercel Blob. Reuse the existing eligible paid Railway workspace/plan only subject to its actual entitlement; no already-paid spare app/scanner host has been proved.

This can avoid the proposed Vercel Pro platform fee, but only after commercial Vercel dependencies are actually retired for TD and the replacement is accepted. It is conditionally cheaper, not a proven lower invoice. In the illustrative light/middle app scenarios below, recurring savings versus the existing proposal are about $14.14/$8.54 per 30 days before tax and unknowns. A heavier app scenario is more expensive. App consumption is NOT measured, and migration engineering/dual-running costs are not included in those savings.

**Do not implement either arrangement under the present $0 authorization.** Continue only the already authorized local investigation. Prefer the alternative only if its measured extra app/cron/storage/network cost is below the avoidable Vercel bill and its migration/security work is acceptable. Otherwise the current Vercel proposal remains the lower-change option, not an approved purchase. This comparison does not amend the current decision packet, authorize a new budget or replace existing release conditions.

## Exactly Two Arrangements

| Component | A: Current proposal | B: One lower-cost candidate |
| --- | --- | --- |
| Application | Existing TD Vercel project on commercial Pro, one deploying seat | One persistent TD-only Railway Next.js service; no app/scanner cohosting |
| Scanner | One isolated Railway ClamAV gateway | Same isolated gateway and acceptance requirements; no assumed scanner savings |
| Database | Existing TD Railway Postgres | Same database identity/data; no database move |
| Private documents | Existing private Vercel Blob | Private Railway bucket with a new reviewed storage adapter; proxy access through the app to preserve authorization/audit |
| Scheduled retention | Vercel cron | Separate short-lived Railway cron calling the authenticated app route, then exiting; no manual call is scheduler proof |
| Existing unrelated resources | Remain untouched | Remain untouched; no cost offset from deleting or repurposing them |

Keeping commercial Vercel Blob while simply moving the app does **not** establish that the $20 Pro cost disappears. Vercel's current Hobby terms restrict its Services to personal/non-commercial use, and Blob is available within its plan system. Candidate B therefore explicitly includes storage retirement/migration rather than assuming a commercial Hobby loophole. [Vercel terms, section4](https://vercel.com/legal/terms), [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).

## Commercial Eligibility And Scope

Railway's current terms expressly include business use; its pricing FAQ recommends Pro for commercial support/resource needs rather than stating a blanket commercial prohibition on Hobby. On those primary sources, a TD-owned business deployment on the eligible existing paid plan is a commercially eligible candidate, not a free tier workaround. Actual account entitlement, support/team needs and any applicable agreement still apply. No conclusion about lawful customer-document processing, jurisdiction or third-party operating authority follows from product-plan eligibility. [Railway terms, effective April20,2026](https://railway.com/legal/terms), [official pricing FAQ](https://docs.railway.com/pricing/faqs).

Vercel's published Pro platform fee is $20/month including one deploying seat and $20 managed-infrastructure usage credit; extra deploying seats and on-demand usage can add cost. We do not treat that credit as cash savings or apply it twice. [Official Pro pricing](https://vercel.com/docs/plans/pro-plan#platform-fee).

## What Is Actually Known

- Existing placement/inventory observations are dated October24 in [infrastructure-20261024.md](infrastructure-20261024.md). They do not prove unused prepaid app/scanner capacity. Current fee/credit/bill is not refreshed by this comparison; no login is requested.
- [Local scanner observations](scanner-local-acceptance-20261024.md) record a real Linux build, selected engine phases and resource samples, but not a hosted consumption average or maximum-file/load acceptance. The 10 MiB deadline/busy behavior remains under the parent's investigation. Those local samples are not inputs labeled as monthly measured usage here.
- There is no measured Railway Next.js app RAM, CPU, traffic baseline, storage-retention inventory or cron duration. None is invented below. All app scenarios are mathematical sensitivity cases, not expected requirements or configured allocations.
- The 4 GiB/0.5 vCPU scanner envelope is the existing proposal's hypothetical cap. It is neither measured mean consumption nor proof that 0.5 vCPU meets the workload. Sharing that envelope between A/B makes the scanner term cancel in the comparison; it does not make either arrangement ready.

## Rates And Metering Convention

All amounts are USD, before tax, foreign-exchange/card effects and account-specific terms. GB means decimal 1,000,000,000 bytes; 4 GiB = 4.294967296 GB. Use integrated measured GB-seconds/vCPU-seconds, not the configured maxima, for a real forecast.

| Input | Rate used in this calculation |
| --- | --- |
| Railway persistent-service RAM | $0.00000386 per GB-second |
| Railway persistent-service CPU | $0.00000772 per vCPU-second |
| Railway volume | $0.00000006 per GB-second |
| Railway service egress | $0.05 per GB |
| Railway bucket storage | $0.015 per GB-month, normalized to30 days, workspace usage rounded up as documented |
| Railway bucket operations/bucket egress | No separate charge; app-service egress is still charged |

Compute/volume/egress inputs use the current public [Railway pricing page](https://railway.com/pricing), not the more expensive VM/sandbox rates. The [plans page](https://docs.railway.com/pricing/plans) also publishes approximate per-minute/month rates; its displayed precision differs from the per-second figures. This document consistently uses the per-second figures, so totals slightly differ from October24's per-minute calculation. These are reproducible estimates, not a resolved tariff discrepancy or invoice. Bucket normalization/rounding and charged service-to-bucket uploads follow the separate [bucket billing documentation](https://docs.railway.com/storage-buckets/billing).

Railway's existing-plan minimum is counted once across workspace usage. Published Hobby is $5/month including $5 usage; Pro is $20 including $20 usage. A service limit is not prepaid capacity, an additional credit pool or a hard bill cap. The current paid-plan identity and any different account pricing remain parameters, not a newly verified invoice. [Plans and included-usage examples](https://docs.railway.com/pricing/plans#included-usage).

## Delta Model

Let:

```text
F   = actual existing Railway subscription floor (5 if ordinary Hobby)
U0  = existing billed workspace resource usage, unchanged by this comparison
Cs  = scanner RAM/CPU/definitions-volume/egress usage cost, same in A and B
Ca  = extra Railway app RAM/CPU usage cost
Cj  = short-lived cron RAM/CPU/egress usage cost
Cb  = Railway bucket storage usage cost
Cn  = extra app service egress in B
EA  = A's Vercel paid usage/add-ons beyond the credited one-seat $20 base
V0  = existing TD-attributable Vercel bill genuinely avoidable in either comparison
Q   = other changed costs: DB load, backups, extra storage, replicas, overlap, etc.

DeltaA = max(F, U0 + Cs + Q_A) - max(F, U0) + 20 + EA - V0
DeltaB = max(F, U0 + Cs + Ca + Cj + Cb + Cn + Q_B)
         - max(F, U0) - V0

Savings B versus A = DeltaA - DeltaB
```

This treats bucket billing as included resource usage under the published plan model; preserve any actually separate invoice line as an additional term instead of absorbing it into a credit. Do not subtract any non-TD bill, assume a refund/proration or claim an existing Hobby $20 fee can be reclaimed. If a non-TD reason keeps Vercel Pro paid regardless, its $20 is not avoidable and the saving argument must be recalculated.

When both arrangements are already above the same Railway floor, common scanner/unchanged workspace costs cancel:

```text
Savings = 20 + EA - (Ca + Cj + Cb + Cn + Q_B - Q_A)
```

This is the useful break-even test. No $0 claim follows from U0 being unknown or credits being available. An account upgrade/team requirement, different fee or separate billing treatment changes the full formula.

## Explicit Sensitivity Calculation

Time: 30 days = 2,592,000 seconds; 31 days = 2,678,400 seconds. Persistent app and scanner are costed as always-on; no scanner cold-start/sleep saving is assumed.

Shared scanner envelope IF continuously fully consumed: 4 GiB RAM,0.5 vCPU,1 GB definitions volume and2 GB service egress per period. The2 GB network number is a sensitivity allowance, not measured signature traffic.

| Shared scanner term | 30 days | 31 days |
| --- | --- | --- |
| RAM: 4.294967296 GB x seconds x RAM rate | $42.97166 | $44.40405 |
| CPU: 0.5 x seconds x CPU rate | $10.00512 | $10.33862 |
| Volume: 1 GB x seconds x volume rate | $0.15552 | $0.16070 |
| Egress: 2 GB x $0.05 | $0.10000 | $0.10000 |
| Common Cs, not a forecast or all-in cap | $53.23230 | $55.00338 |

Actual measured average scanner consumption may be different. Resource caps, rollout overlap and billable volume basis must be verified; definitions volume is budgeted at its full proposed1 GB, not the local108 MiB contents.

Additional B-only assumptions, all unmeasured:

- Cron: one run/day,30 seconds/run including startup/cleanup,0.25 GB RAM and0.1 vCPU throughout; no persistent volume. This is900/930 seconds per30/31 days and costs $0.00156/$0.00162 in compute. A stuck run is not bounded by this model and must not be left running.
- Bucket:10 GB average retained storage, not10 GB monthly uploads. With30-day normalization/whole-unit rounding, the illustration is10 GB-month ($0.150) or10.3333 rounded to11 ($0.165) for31 days. The current actual retained inventory is unknown; all environments/retained copies and continued accumulation count.
- App egress:5 GB browser/API output plus0.5 GiB uploaded to the bucket plus0.5 GiB forwarded over public HTTPS to the scanner =6.073741824 GB, costing $0.30369 per period. Bucket-to-app download is not bucket egress billed again, but app-to-user bytes belong in the5 GB allowance. Scanner replies/updates belong in Cs; cron headers are assumed within the5 GB allowance. No private-network saving is assumed for a scanner client currently requiring HTTPS.
- Extra app persistent storage:0 GB; durable data stays in Postgres/bucket. Logs, backups and retained artifacts beyond those assumptions belong in Q, not a claim of free storage. App compute cases below are hypothetical **billed averages**, not recommended limits or measured usage.

Assume solely for this comparison that the same Railway floor is exceeded, EA=0 (all A usage covered by its actual Pro credit/allocations), Q_A=Q_B=0 and no extra seat. Savings are relative to A, not the current real invoice.

| Hypothetical app average | App RAM cost,30d | App CPU cost,30d | B-only app+cron+bucket+egress,30d | Saving versus A,30d | B-only addition,31d | Saving,31d |
| --- | --- | --- | --- | --- | --- | --- |
| 0.5 GB RAM /0.02 vCPU | $5.00256 | $0.40020 | $5.85802 | $14.14198 | $6.05316 | $13.94684 |
| 1 GB RAM /0.05 vCPU | $10.00512 | $1.00051 | $11.46088 | $8.53912 | $11.84279 | $8.15721 |
| 2 GB RAM /0.1 vCPU | $20.01024 | $2.00102 | $22.46651 | -$2.46651 | $23.21528 | -$3.21528 |

For scale only, adding shared full-envelope Cs gives30-day incremental resource/base-fee examples A=$73.23230, B-light=$59.09032, B-middle=$64.69319, B-heavy=$75.69882, above an otherwise unchanged already-over-floor baseline and before excluded charges. These are NOT quotes, minima, approved budgets or estimates of the unmeasured app. They also do not predict the parent's scanner performance result. Under these assumptions B is cheaper only while its B-only addition stays below $20; EA and Q differences move that boundary.

## Storage And Scheduler Tradeoffs

Railway documents buckets as private and S3-compatible; keep document access authenticated through the app, not a public bucket or unreviewed bearer-link workflow. Native S3 server-side-encryption APIs, versioning, object locks and lifecycle configuration are listed as unsupported. That is a feature gap, not evidence that every storage layer lacks encryption. Storage/security acceptance must establish the required protection, immutable-version behavior, key custody and retention/backup handling; application-level authenticated encryption may require additional implementation and compute not priced above. [Official bucket capabilities](https://docs.railway.com/storage-buckets#s3-compatibility).

Railway cron schedules use UTC; the task must finish and exit, and overlapping runs are skipped rather than killed. A small dedicated caller can preserve the authenticated retention endpoint rather than running the web server as a scheduled task. No new worker entry exists merely because this architecture is described; implement bounded network/process exit, close resources and verify provider-correlated actual scheduling before retiring Vercel cron. No manual invocation is proposed. [Official cron lifecycle](https://docs.railway.com/cron-jobs).

## Migration Plan And Risks: Not Initiated

1. **Host portability first, on local synthetic data.** Next.js supports self-hosting, but this repository is not a turnkey Railway app. Its production-document checks, policy activation, recovery origins and adapter configuration include Vercel-specific assumptions; change them explicitly while preserving fail-closed real-M3 checks. Do not fake Vercel environment variables, enable test flags or relax deadlines as a hosting workaround. Port/health/TLS, secure cookies, proxy trust, cache/image behavior and shared rate limits need verification. [Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting).
2. **Separate services and privileges.** The scanner keeps only its authentication secret/signatures, not DB/bucket/customer credentials. The app owns permitted DB/storage access; the cron caller needs only endpoint authorization. Keep TD in an explicitly owned namespace separate from NOX/B2C; never put the app/scanner into Postgres. Private DB networking can avoid public DB egress, but current endpoint/schema fingerprints and isolation guards must be revalidated rather than silently changing identity. [Railway private networking](https://docs.railway.com/networking/private-networking).
3. **Implement a real private storage adapter.** `lib/documentStorage.ts` currently supplies Vercel Blob and test-only isolated filesystem, not a Railway S3 adapter. Preserve create-without-overwrite, bounded reads, checksum/size/content-type checks, access audit and uncommitted-object cleanup. A new S3 ETag is not automatically the old Blob ETag or the file SHA256: immutable stored integrity references need an explicit reviewed migration/mapping rather than rewriting historical rows casually. No real object inventory/copy was performed here.
4. **No storage move without approved handling.** When separately authorized, take protected DB/object inventories and restorable backups; copy only authorized TD objects, verify bytes/checksums and reconcile every stored reference before cutover. Address versioning/retention/encryption gaps, deletion semantics and failure recovery. Price migration reads, writes, double storage, app overlap and egress as Q. Do not delete the old store, rotate away needed keys or pretend a DB-only backup contains its binaries.
5. **Controlled cutover, not an extra deployment now.** Rehearse the existing17-migration manifest against actual applied history (13 versus14 remains conditional), old/new-runtime compatibility and the existing release-runbook sequence. Migrations precede exposing new code; builds do not silently migrate Production. Obtain the existing required specialist/provider/release approvals, then separately authorize paid provisioning, verify exact new app/scanner identities, protected access and provider adapters, and reconcile synthetic smoke/customer baselines under containment. No stale candidate48/8a CI/UAT result certifies this port.
6. **Keep only one active retention scheduler at cutover.** Preserve evidence for both the old and new runtime; do not equate cron configuration with execution. Prepare explicit rollback of app routing, scheduler enablement and storage-reference mapping while retaining data/history. A runtime rollback alone cannot undo new object locations or replay external effects. Retiring TD Vercel costs requires successful migration and actual bill attribution; do not downgrade a shared team or cancel another project's service.

This is an architecture comparison, not a new full audit or instruction to start migration. The parent owns scanner size/workload diagnosis; candidate B does not solve the10 MiB timeout merely by moving the app. No measured app demand, current invoice, eligible spare paid host or guaranteed global cheapest arrangement was established. Existing release conditions remain; no new approval has been fabricated.

## Source And Handoff Record

Official primary sources were read on **2026-10-25**; link targets, not community posts/template promises, underpin this comparison. Commercial scope: Railway terms/FAQ and Vercel terms. Rates: Railway public pricing/plans, Railway bucket billing, Vercel Pro/Blob pricing. Operations: Railway buckets/cron/private networking and Next.js self-hosting. All claims above carry their relevant link near the calculation or constraint.

Local context read only: `infrastructure-20261024.md`, `decision-point-20261024.md`, `scanner-local-acceptance-20261024.md`, `lib/documentAdapterPolicy.ts` and `lib/documentStorage.ts`; prior scoped source review supplies portability risks, not a new completed audit. No private receipts, account API, invoice session, production query, cloud/VM access or tests were used for this comparison. The owner is not being asked to log in or authorize spending by this document.
