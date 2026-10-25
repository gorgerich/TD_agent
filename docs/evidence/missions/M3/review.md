---
schema: m3-independent-review-v1
reviewed_sha: 87d480daa62330e9ad638f68baf3c761a5f8ff4f
reviewer: Codex independent source and CI review sidecar
verdict: PASS
p0: 0
p1: 0
p2: 0
---

# Independent Cumulative Source And CI Review: 87

Engineering source verdict only: no remaining P0/P1/P2 finding in the reviewed cumulative chain and bounded successor delta. This is not genuine GitHub approval, Finance/Legal/Ritual approval, fresh native Preview UAT, green overall CI, hosted scanner acceptance or release authorization. Authorized incremental spend remains $0.

## Exact Binding And Scope

- Source: `87d480daa62330e9ad638f68baf3c761a5f8ff4f`; tree: `a0b7ac9c17ede752b844cf285a2c9b080e650642`. Local HEAD matched and worktree was clean at review entry.
- Prior approved executable source: `48eef7cd34b4cc2f9898dadf4506a32da8699962`; cumulative baseline: `91ae4fb23b8f87c0574ccec23708daeabdc50fc9`.
- Incorporates, without relabeling their executions, the existing48 cumulative source review in `docs/evidence/missions/M3/review.md`, the DA review in `docs/evidence/missions/M3/historical/pr39-da-packet-20261023/review.md`, and earlier reports under `docs/evidence/missions/M3/historical/review-chain-pr39/` (readiness-review-20261018 and final-review76/9b/DA). Existing48 evidence-compiler review is separately recorded in `technical-readiness/pr39-48-evidence-review.md`.
- This review extends that chain with an actual inspection of48..87:21 non-documentation files,1083 insertions and4 deletions. The overall79-file diff also includes historical archives, dated evidence, screenshots and decision/runbook documents. These are not79 newly changed runtime modules or newly executed audits.
- Commits after48:030793c and8a7115e evidence/documentation,283dbcb scanner/collector preparation,87d480d measured profiling/serial reload. `git diff --check 48..87` succeeded.
- Independently checked no48..87 differences in `prisma`, dependency manifests/lockfile, `.github`, the evidence validator, policy activation/proof and contract-ledger implementation. Prior money, reviewer credential, signing, immutable history, native migration and deployment protections therefore retain their earlier review binding; they were not rewritten or newly audited line-by-line here.

## Successor Source Review

### Runtime Upload, Replay And Audit

`app/api/agent/cases/[caseId]/documents/route.ts` retains authentication, canonical case resolution and bounded multipart validation. Removing the route's scanner preflight allows a committed idempotent response to be recovered during a later scanner outage.

`lib/documentService.ts` now validates file bytes/checksum, checks active real-M3 policy preflight and same-tenant/current case scope before retrieving the matching fingerprint-bound replay. A new upload must pass operational/live scanner readiness before private storage writes. Changed payload conflicts remain409; unavailability does not fabricate a new successful version or invalidate a still-valid verified predecessor. Retry retains its own authorization/replay path. The existing production-policy transaction remains around persisted mutation, and CLEAN still means uploaded for independent review, never automatically VERIFIED.

Engine evidence in the document audit is explicitly projected to engineVersion, signatureVersion and definitionsAt after shared protocol validation. Raw provider response fields, filenames, bearer secrets and document contents are not added to that snapshot. Existing encrypted/controlled metadata handling is not replaced.

### HTTP Scanner And Gateway

`lib/documentScannerHttp.ts` accepts a configured HTTPS origin without URL credentials/path/query/fragment, refuses redirects, applies a12-second abort signal, bounds response parsing to2 KiB, hashes exact bytes and requires matching checksum, provider, fresh engine metadata and coherent CLEAN/INFECTED result codes. Exceptions/unknown responses stay ERROR; diagnostics are fixed/non-secret. The shared protocol requires canonical ISO UTC timestamps with round-trip equality, positive safe signature version and bounded freshness, not a permissive date string carrying arbitrary comments.

`services/document-scanner/server.mjs` authenticates before engine/body processing, exposes only bare process liveness unauthenticated, bounds input10 MiB and connection count32, validates declared length/checksum and supported basic file signatures, and admits only one active operation. Health is bounded through the local private daemon socket; clamdscan uses fixed arguments without caller paths or shell interpolation and has a10-second kill deadline. Non-clean/detection/error exits do not map to CLEAN. Basic format checks are not complete parsers, authenticity checks or professional document verification.

Container configuration explicitly installs clamdscan, keeps the daemon socket private and runs application/daemon/updater under clamav after root directory preparation. Serial reload is now `ConcurrentDatabaseReload no`; `TestDatabases yes`, file/scan limits and detection flags remain enabled. Database reload can block new work and yield retryable failure; liveness is not readiness. Restart count3 and startup-health timeout300 are proposed service settings, not applied provider state or a spending cap.

The12-second caller bound is not an end-to-end guarantee that underlying daemon work is canceled at that instant. Busy429 while the existing operation settles is deliberate refusal, not invented protection/throughput PASS. Earlier0.5CPU/concurrent-reload failures remain evidence; serial-reload local observations do not prove hosted sizing, future signature peaks or an SLA.

### Operator Tools And Collector

`scripts/ops/collect-retention-observation.mjs` is a bounded read-only provider-log capture, not a cleanup caller. It requires the exact route, UTC observation window and recent timestamps, limits the CLI read, strips token override and projects only approved metadata/fixed completion fields. Nested log messages and conflicting completion rejection are included. HTTP200, arbitrary log text and user agent do not supply scheduler/cleanup proof. Installed Vercel54 does not emit requestType in this output mapping; absent classification remains UNVERIFIED. Private receipts do not constitute actual scheduled success.

`scripts/ops/accept-document-scanner.mjs` uses generated synthetic PDF/EICAR inputs, explicit operator confirmation, a private token file, bounded responses and whitelisted phase receipts. Its result is phase-only, explicitly not aggregate Production readiness. It does not create a resource, stop a serving daemon or send customer files itself.

`scripts/ops/profile-document-scanner.mjs` is local/synthetic, randomizes valid PDF whitespace to distinguish fresh scans from repeats, creates request-local server/timing state, tracks both health and scan pending state in finally and stops remaining fixtures when work remains unsettled. Rejected scans record timing without being mislabeled permanently pending. CPU is whole-container usage and memory is a25ms sampled cgroup maximum, not a guaranteed peak or monthly consumption. No client/child deadline was increased to obtain success.

### Tests And Earlier Findings

New scanner HTTP tests cover configuration/authentication, checksum/result validation, malformed/unsupported inputs, stale or malformed metadata, bounds, concurrency and actual stalled-HTTP/child-process deadline behavior. The latter use local/fake components, not a newly deployed ClamAV provider. Collector tests cover window/non-fabrication/nested/conflicting/receipt boundaries; acceptance tests explicitly distinguish simulated-engine phases; profiler tests cover valid10 MiB fixtures, rejected/unsettled health/scan paths and protected unique configuration directives. Document tests add failed-health preservation and committed-response replay/conflict checks.

Closed during the review chain: missing Docker clamdscan dependency; live-health-before-committed-replay ordering; shared profiler timing state after timeout; incomplete settlement tracking for rejected scans/unsettled health. Final source includes the corrections. Existing unit harnesses still mock some authorization/database boundaries; actual CI PostgreSQL/browser coverage is separate evidence, not proof that every new mocked negative is exercised. No full suite was rerun by this sidecar.

## Independent Exact87 CI Receipt

Normal authenticated GitHub CLI reads used `GODEBUG=http2client=0` for the reported HTTP2 transport issue; no authentication/credential fallback. The completed [run40133907137](https://github.com/gorgerich/TD_agent/actions/runs/40133907137) reports head87 and overall **failure**. Verify job120991252300 is completed/failure; its sole failed step is `Validate authoritative mission evidence`.

Full log stdout was downloaded completely into private process memory,2,013,518 bytes, SHA256 `437df93f931d976c59af65aa3e14a923c39312cc19421ec265c2609f13fa054c`. Its completed-job tail and PR head87 SHA were present. Actual Actions checkout was PR merge ref `85e906eb25ef2aecdd5f31da71e8df7aa31d89bc`, not a direct checkout of87. That object is absent locally, and merge-tree equivalence with87 was not independently established. This is execution evidence for the run bound to PR head87, not proof of exact head-tree equality. Numeric summary groups were independently parsed/summed from this exact run, not copied from48:

| Group | Tests/pass | Fail | Skipped | Cancelled | Complete summaries |
| --- | --- | --- | --- | --- | --- |
| Unit | 321/321 | 0 | 0 | 0 | 1 |
| Latency | 124/124 | 0 | 0 | 0 | 7 |
| PostgreSQL integration | 207/207 | 0 | 0 | 0 | 29 |
| Five repeated risk rounds | 575/575 | 0 | 0 | 0 | 70 |

The latency summaries are23 five times, then7 and2. Repeated-risk summaries are14 per round across five rounds. All five numeric fields had the same number of complete summary blocks within each group. Equal old/new integration/latency/repeat totals are observations from the87 log, not reassigned48 counts.

All27 technical job steps3-29 succeeded, including checkout, installation, migrations/legacy fixtures/no-op/parity, lint/typecheck, tests, synthetic encrypted restore, build and browser stages. The prior48 receipt listed26 technical steps by excluding checkout; this is a counting-convention disclosure, not a new gate or a waived step. Six chained E2E programs, auth-infrastructure recovery and seven chained component programs completed in their successful CI steps. Parsed M3 browser results include reconciliation0, unexpected5xx0 and skipped0. Optional failure diagnostics and the post-setup-node cache action were skipped workflow steps; no claim of zero skipped workflow steps is made.

All four named fixture cleanup steps succeeded and each emitted one CLEAN marker. The restore step emitted its actual encrypted restore/aggregate-count/schema-parity PASS marker. That is an isolated synthetic CI restore, not a fresh encrypted Production backup or customer-content digest proof.

The exact evidence failure is: `M3: implementationSha 48eef7cd34b4cc2f9898dadf4506a32da8699962 has source changes relative to HEAD`, exit1. It is not a lint/test/runtime failure and it is not overall green CI. The unchanged validator must later accept truthful successor evidence, followed by the actual final evidence-head required CI; neither outcome is presumed here.

Sanitized receipt: `/private/tmp/td-agent-87d480d-ci40133907137-independent-receipt.json`, using the prior receipt field structure and omitting unverified optional details. No raw logs, credentials, cookies, private payloads or arbitrary provider diagnostic strings are published in either artifact.

## Helper And Remaining Native Boundary

The preceding source-only review approved external Preview helper SHA256 `35e1a57a71d7f97e103107c5c958aabf1ed5925b1bf9b3d9ca4a6a7df9209380`: reversing its sole87 pin reproduced prior approved48 hash `057735aba8b692bdd4d2635645f60ae3dd5360bc2d901ea2447e40608dbf87fb`. It retains clean local/remote source, principal/project/team/repository/branch/protection, exact READY non-Production deployment, approved private store, native545/not025 and fresh empty schema guards; authenticated fresh-fixture readback precedes publication/browser writes. Owned synthetic access containment preserves history and exposes unresolved configuration recovery rather than claiming restoration.

That helper review is not execution. Fresh native87 preparation/redeployment/UAT, actual browser results/screenshots and final containment receipt are being handled by the parent and have **not** been independently inspected for this artifact. Do not import48 UAT, contained credentials or screenshots as87 acceptance. A separate final native-evidence review remains necessary before any truthful successor acceptance claim.

Subsequent handoff: the later, separate `readiness-87-native-evidence-review.md` reviews the fresh87 run. The preceding paragraph describes the source/CI review boundary at its initial completion; it must not be treated as a claim that the later native artifact was already inspected then.

## Limits And Handoff

This report extends prior approved source reasoning plus independently observed87 CI technical execution. It does not independently reproduce the parent's Linux/ClamAV VM measurements or establish the exact original timeout root cause. Local sampled resource evidence and documented serial-reload downtime remain scoped observations, not accepted hosted performance or an approved smaller bill.

Hosted scanner/commercial infrastructure/processing authorization, actual scheduled retention, genuine specialist verdicts/current credentials, eligible GitHub review, fresh native Production inventory/backup/isolated restore/rehearsal and controlled rollout remain distinct existing boundaries. Native13 versus14 applied migration history is unresolved here; the17-file source manifest is unchanged. No Production/DB/VM call, paid resource, source/CI/repository edit, full-suite execution or approval impersonation was performed by this sidecar.

Only this external report and the requested sanitized external CI receipt were authored. Keep source87 and actual evidence identities distinct when the authoritative documentation is repaired. Overall CI is currently failure; real rollout is not authorized by this source verdict.

## Fresh Native Evidence Review

The separate [fresh native evidence review](technical-readiness/pr39-87-native-review.md) independently supports the scoped87 authenticated Preview run, with P0=0 and P1=0. Its complete report, limitations, screenshot checks and containment observations remain in that artifact. It is not a professional verdict, hosted scanner acceptance or Production readiness.
