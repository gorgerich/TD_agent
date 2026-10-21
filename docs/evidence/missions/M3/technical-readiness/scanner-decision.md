# Production Scanner Decision

## Owner Scope Correction, 2026-10-20

The owner rejected the proposed incremental $55/month budget. The recommendation below is HISTORICAL / NOT AUTHORIZED, not the current spending request or an approved deployment. No scanner service or paid plan has been provisioned. The target is real Production operation, not synthetic-only CPO readiness. See [new resource observations and remaining feasibility work](real-production-scope-20261020.md). Do not infer impossibility of a zero-incremental-cost solution from the historical 90-second local attempts or the recommended container size.

Status: PRODUCTION_SCANNER_PROVIDER_REQUIRED. No approved Production scanner is connected. Unavailable scanner blocks uploads before storage/database writes; errors/timeouts cannot become CLEAN or VERIFIED. Synthetic Preview scanning is not Production acceptance. An applicable existing VERIFIED version is preserved while a replacement remains unverified.

## Feasibility Facts

No scanner variable names were present in the inspected Vercel Production configuration and no scanner service was found in the inspected TD Railway project. NOX was not modified. Local feasibility extracted the official notarized Cisco ClamAV 1.5.4 package without system installation. FreshClam actually verified daily28157, main63 and bytecode339 definitions. Two cold clamscan attempts with synthetic clean text/EICAR exceeded the 90-second local process deadline while loading definitions. Neither test is recorded as CLEAN/INFECTED/PASS. No client documents were submitted.

## One Recommended Option

An isolated scanner-only Railway project under the existing account, outside the TD/NOX private network: pinned rootless resident clamd, no database credentials, no public clamd port, authenticated TLS gateway for Vercel. Accept bounded bytes only, never caller-controlled URLs, SQL or paths. Require dedicated rotatable authentication, checksum/MIME/body validation, no redirects or document/secret logging, bounded queue/concurrency/archive expansion, finite deadlines and fail-closed health. Keep signed signature updates separate from scanning; export version/age, update/reload errors, queue/latency/failure metrics and stale-definition alerts. Do not retain document bytes in its volume.

Proposed initial envelope requiring actual load tests: 4 GB RAM, 0.5 vCPU, one replica, two admitted scans, 1 GB definitions volume, five-second warm scan deadline. These are proposed limits, not deployed or verified capacity. Cold per-upload processes are not acceptable based on the observed feasibility failure.

## Cost and Required Decision

[Railway unit prices](https://railway.com/pricing), rechecked 2026-10-20: RAM $0.00000386/GB-second, CPU $0.00000772/vCPU-second, volumes $0.00000006/GB-second, service egress $0.05/GB. Continuous consumption at the proposed envelope is $50.18112 per 30 days or $51.853824 per 31 days before egress/tax and existing services. Estimated initial incremental usage is $30-52/month plus egress; this is not a fixed bill or benchmark. No unused Hobby credit is assumed. Resource limits alone are not a billing cap; alerts and suspension/review before overrun are required.

Owner decision: approve or reject this self-hosted option with an incremental budget up to $55/month, without a plan upgrade or a new document processor outside the existing Railway relationship. No billed resource has been created before that decision.

## Actual Acceptance Still Required

Record real deployment/image digest, engine and signed definition versions/age, authenticated access proof, clean/EICAR/corrupt/unsupported/unavailable/timeout/retry/unauthorized synthetic tests, resource/load measurements, signature update/reload and stale/failure alerts. Exercise application quarantine, replacement preservation, rescan, access audit and recovery. One EICAR test alone is insufficient. [ClamAV configuration reference](https://docs.clamav.net/manual/Usage/Configuration.html).

Provider acceptance and professional Finance/Legal/Privacy/Ritual verdicts remain separate. Broad agent rollout is closed.
