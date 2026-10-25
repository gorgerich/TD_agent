# Final Scanner Proposal - 2026-10-25

Status: DRAFT_UNAPPROVED / NO_PROVISIONING. Additional spending remains prohibited.
Neither the rejected $80 reserve nor any smaller amount is authorized by this document.
Prepared outside the repository to preserve clean exact-HEAD Preview preparation/UAT.
Read-only source binding: `87d480daa62330e9ad638f68baf3c761a5f8ff4f`.
Parent may integrate this document only after UAT; this is not authoritative UAT evidence.

## One Placement Recommendation

Keep the application on its existing Vercel project, documents in the existing private
Blob store, and TD Postgres in place. No application/storage migration is proposed.
After explicit authorization only, add one TD-only Railway container service named
`td-document-scanner` in the existing TD project
`204385e0-1f5d-4711-ac49-74475d0d7093`, isolated from Postgres and NOX.
Proposed scanner region: EU West Metal, Amsterdam, `europe-west4-drams3a`, subject
to Legal/Privacy approval of this processor and transfer/location. It is an available
[Railway region](https://docs.railway.com/deployments/regions), not a claim about current data residency.
If that location is not approved, do not provision or silently choose another region.

Use one gateway + ClamAV daemon + FreshClam container, one replica, 2 GiB RAM /
1 vCPU ceiling, no autoscaling, and a 1 GB definitions volume. Customer files must
not be persisted on that volume. Keep authenticated TLS access from the existing
Vercel app; Railway private networking is not presumed reachable from Vercel.
Do not expose clamd's socket/TCP protocol publicly. Do not give the scanner database
credentials, public Blob access, or reusable document URLs. No paid logging add-on.
The existing TD workspace contains unrelated services: project membership does not
authorize touching them or consuming their supposed spare capacity.

Current configuration is preparation, not an already deployed/enforced envelope.
Verify provider limits and region after any later authorized provisioning.

## Measured Basis And Limits

Source: repository `docs/evidence/missions/M3/technical-readiness/scanner-profile-20261025.md`.
These are synthetic local Linux observations, not hosted capacity or monthly averages.

| Observation | Recorded result |
| --- | --- |
| Verified cgroup ceiling | 2,147,483,648 bytes / 1 vCPU |
| Final fresh 10 MiB file after reload | CLEAN, 7.823 seconds client total |
| Final scan sampled memory maximum | 1,235,705,856 bytes, about 1.151 GiB; includes benchmark client |
| Serial signature reload | 49.561 seconds; 19 readiness probes unavailable; recovery passed |
| Reload sampled memory maximum | 1,074,884,608 bytes |
| OOM / oom_kill counters | 0 / 0 in recorded runs |
| Current definitions size | 108 MiB; not a future-growth guarantee |
| One cold scan whole-container CPU | 7.814796 CPU-seconds, including client |

Memory was sampled every 25 ms; kernel absolute `memory.peak` was unavailable.
This is the smallest tested complete contour, not proof that smaller instances fail,
that future signatures fit, or that this contour meets production latency targets.
Do not substitute the sampled maximum for billed monthly resident memory.

Recorded serial-reload image manifest:
`sha256:6055162e1994be7cd2f58fec95c7e520e8835864479a490b9a08ac1914c85a5b`.
Profile records Debian ClamAV 1.4.6 and signatures 28163. Preserve the source/image
binding and record new engine/signature identities at hosted acceptance.
No repeat timeout diagnosis is needed for this proposal.

## Workload Assumptions

Planning only: 10 staff, 100 cases, 500 file versions and 0.5 GiB new document
content per month, maximum 10 MiB per file, one active scan. These are not observed
demand. Average file size implied by that volume is about 1.05 MiB, not 10 MiB.
Rescans, rejected uploads, retries and malicious traffic increase work beyond 500.
500 times the observed CPU sample is 3,907.398 CPU-seconds; that excludes updates,
idle work, transport differences and other files, and is not a complete CPU forecast.
Signature downloads are ingress to Railway; update validation/reload still consume
CPU/RAM. App/Blob outbound transfer and operations are separate metered dimensions.

## Cost Model

Official public [Railway container prices](https://docs.railway.com/pricing/plans),
checked 2026-10-25: RAM $0.000231/GB-minute; CPU $0.000463/vCPU-minute;
volume $0.000003472222222/GB-minute; outbound $0.05/GB. Convert minutes to seconds
by dividing by 60 throughout; do not mix rounded monthly/second schedules.
GB inputs below are decimal; 2 GiB = 2.147483648 GB. These are container, not VM rates.

For 30 days (2,592,000 seconds), with M average GB RAM, C average vCPU,
V allocated volume GB and E billed outbound GB:

```text
S = 2592000 * (M * 0.000231/60 + C * 0.000463/60
              + V * 0.000003472222222/60) + E * 0.05
```

Sensitivity calculations, not forecasts or quotes; CPU includes assumed total
idle/update/scan work. Volume is conservatively charged at the full 1 GB allowance.

| Scenario | Average RAM GB | Average vCPU | Volume GB | Outbound GB | RAM $ | CPU $ | Volume $ | Outbound $ | Scanner usage S $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 1.10 | 0.002 | 1 | 0.1 | 10.98 | 0.04 | 0.15 | 0.005 | 11.17 |
| Reference | 1.30 | 0.010 | 1 | 1 | 12.97 | 0.20 | 0.15 | 0.05 | 13.37 |
| Stress | 2.147483648 | 0.100 | 1 | 10 | 21.43 | 2.00 | 0.15 | 0.50 | 24.08 |
| Full compute ceiling continuously | 2.147483648 | 1.000 | 1 | 10 | 21.43 | 20.00 | 0.15 | 0.50 | 42.08 |

Totals use unrounded components. No row is RAM-only. Last row is not a dollar cap:
traffic, longer billing periods, deployments overlapping and additional resources
can increase charges. No paid add-ons, taxes, FX or engineering/on-call labor are
included; those are additional costs, not implied free services.

Fixed incremental scanner subscription: $0 only if an existing eligible paid plan
is unchanged. Otherwise model the plan change explicitly. Hobby's $5 and Pro's
$20 floors include usage once, not additive free allowances. [Plan source](https://docs.railway.com/pricing/plans).

Let U be unchanged existing workspace usage and P its unchanged subscription floor:

```text
Railway bill delta = max(P, U + S) - max(P, U)
Total platform delta = Railway bill delta + (VercelAfter - VercelBefore)
                     + extra Blob/app operations and transfer + taxes/FX
```

If the Railway floor is already consumed, the four scanner deltas equal S above.
If not, the unused allowance can reduce incremental billing, but current U/P/credit
were not retrieved here. No current invoice, guaranteed spare allowance, savings,
or actual zero-cost arrangement is established. If the plan changes, use separate
before/after floors; never subtract NOX, retained restore or unchanged DB costs.

Commercial application hosting is a separate unresolved condition:
[Vercel Hobby](https://vercel.com/docs/plans/hobby) is personal/non-commercial.
[Pro](https://vercel.com/docs/plans/pro-plan) has a $20/month platform fee with
one deploying seat and included usage credit. If moving from Hobby to Pro later
becomes authorized, and the Railway floor is consumed, reference scanner plus
that fee is $33.37/month incremental before app/Blob excess, taxes and FX; stress
is $44.08. This is not the entire existing platform invoice. Ten application staff
do not mean ten Vercel deploying seats. No upgrade or budget approval is requested now.

## Bill And Failure Controls

These are proposed controls to configure only after explicit authorization:

- Keep one replica with enforced 2 GiB/1 vCPU caps, bounded ingress and request
  size, one engine thread, bounded queue, bounded retries, and no automatic scaling.
  Test saturation/rejection behavior; do not promise untested throughput.
- Monitor billed RAM/CPU/volume/egress separately, daily cost trajectory, signature
  age, readiness, reload duration, retry/error rate and OOM. Compare the first
  authorized measurement interval with the reference assumptions before expansion.
- Owner must define an incremental monthly ceiling B, recipient and response owner
  before provisioning. Proposed scanner alerts at 50%, 75% and 90% of B and on
  projected overspend; no particular dollar amount is authorized by this draft.
- A resource cap is not a spending cap. Railway offers workspace compute alerts
  and a hard limit; that limit can shut down all workloads, including unrelated
  services. Do not set/change it in this shared workspace without explicit impact
  approval. See [Railway cost control](https://docs.railway.com/pricing/cost-control).
- Prefer scanner-specific admission/stop handling over a shared-workspace shutdown.
  Its automation must be implemented and tested before claiming enforcement;
  stopping compute does not erase accrued charges or retained-volume charges.

Keep serial reload (`ConcurrentDatabaseReload no`) and database validation enabled.
During reload, stale definitions, overload, outage, OOM or deadline failure, new
uploads/rescans remain blocked or receive the existing retryable scanner error;
never manufacture CLEAN, lower checks, expand timeouts or bypass verification to
hold a budget. Do not invalidate valid existing evidence merely because scanning
is temporarily unavailable. Preserve quarantine, version history, ledger and audit.
If cost containment stops the scanner, communicate document intake interruption;
do not silently fall back to unscanned processing. Serial reload has a measured
49.561-second interruption, not an SLA or continuous availability guarantee.

## Acceptance And Remaining Decisions

Engineering readiness and real release are separate. Local tests do not establish
hosted acceptance. After later authorization, require exact-image hosted tests for
clean supported formats, EICAR, malformed/encrypted/oversized inputs, auth rejection,
fresh unique 10 MiB files, updates/reload recovery, freshness failure, saturation,
timeout/outage and memory/CPU/egress measurements. Confirm no file retention or
secret leakage. End-to-end app-to-scanner latency must fit the existing deadline;
local 7.823 seconds alone does not prove it. Keep current formats/limits pending
actual pipeline acceptance and qualified policy approval.

| Decision owner | Still required for real release |
| --- | --- |
| Owner | Maintain current $0 additional-spend prohibition; no provisioning now. Any later change needs an explicit ceiling, operating interruption tolerance, response owner, first organization and scope. No migration is implied. |
| Owner / hosting account owner | Resolve commercial Vercel hosting and exact future billing baseline before real use; approve any future paid change separately. |
| Finance | Validate confirmed-receipt evidence, immutable obligations, effective balance/refund treatment, distinct correction/reversal approval, and any commission rules. No invented monetary exemption. |
| Legal/Privacy | Approve jurisdictions, processor/location/transfers, purposes/bases, contact channels, contract/signing meaning, retention by data category, rights handling and backups. Amsterdam is a proposal, not approval. |
| Ritual SME + Legal | Approve distinct cremation/family-plot requirements, accepted alternatives, authority, expiry, supported conditions, formats and blocking stages. |
| Engineering / release owner | Fresh exact-runtime authenticated UAT and authoritative evidence, overall CI without weaker validation, actual scheduled-cron proof, later hosted scanner acceptance, genuine versioned policy enrollment, backup/isolated restore, migration preflight and protected release/smoke. |

No policy verdict, scheduled-cron PASS, hosted PASS, Production readiness, merge,
deployment or customer-data processing is asserted here. Parent owns current UAT/CI
and scheduled observation; this document must not relabel historical results.
No UI was designed or changed, so interface-specific design checks are not applicable.
