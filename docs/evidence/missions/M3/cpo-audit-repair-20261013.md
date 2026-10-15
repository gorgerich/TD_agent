# CPO Audit Repair: 2026-10-13

State: IMPLEMENTING. Not release evidence or a PASS declaration.

Baseline: GitHub main 87550178d6b4ba60b3f752880fd08674c6fd2835;
serving Production dpl_8rqT8aRp2x75wfxHVpmJBaMigytY at the same SHA,
READY; freeze disabled. M3 writes remain restricted to the existing synthetic
CPO organization. Human Finance/Legal/Privacy/Ritual verdicts remain PENDING.
NOX is excluded; M4 is NOT_STARTED.

Source: owner's `TD_agent_аудит_M3.html`, read in full, including hidden tabs.
It contains 49 digrow records: 14 technical summary, one regression, 34 detailed.
References H01-H49 below use DOM order, not a claim that all are independent.
Several source dig descriptions are themselves truncated; source agent counts
and severity labels are not verification evidence.

## Canonical Finding Registry

All FIX rows initially have status REPRODUCE / IMPLEMENT / VERIFY_PENDING.
Tests listed are required checks, not claims of execution. Final decisions and
evidence will be updated from actual executions on the final runtime tree.

| ID | Sources | Code | Severity / reason | Decision | Required regression |
| --- | --- | --- | --- | --- | --- |
| CPO-01 | H01,19-22,26 | m3Domain, caseService, caseReadModel, contractLedgerService | P1: covered obligation blocked after refund | FIX | surplus refund; repay; full refund; debt; pending; projection refresh |
| CPO-02 | H02,15,23 | platform-admin, organization membership APIs | P1: first-admin onboarding impossible | FIX | SUPER_ADMIN/MFA/confirmation, parallel/replay, tenant denial, invite roles |
| CPO-03 | H03,36 | contractLedgerService, m3Domain | P2: threshold bypass by splitting | FIX | cumulative source/obligation, concurrent requests, approved policy threshold |
| CPO-04 | H04,32 | documentScanner, documentService, upload route | P2: unavailable scanner mutates valid document truth | FIX + EXTERNAL_DECISION | provider unavailable 503, quarantine preserves VERIFIED, bounded upload/type validation |
| CPO-05 | H05,33 | m3PolicyActivation, documentRequirementService | P2: accepted unsupported conditions fail materialization | FIX | condition vocabulary, conditional/required consistency, extensible stableKeys |
| CPO-06 | H05,24,33 | caseService, intake route/UI | P1: ceremony save silently leaves old scenario | FIX | safe correction, consequences block, replay/rollback, truthful UI |
| CPO-07 | H06,34 | documentService and additive DB enforcement | P2: self-review through membership change | FIX | stable uploader user identity, queue/start/decision denial, expiry validation |
| CPO-08 | H07,35 | documentService escalation | P2: closed task mutated with false success | FIX | closed escalation, assigned owner, before/after, replay |
| CPO-09 | H08,40 | casePartyService, contracts, reconciliation | P2: payer role drift after contract issue | FIX | issued/signed payer protection, historical snapshot, multiple payers retained |
| CPO-10 | H09,41 | casePartyService, quote publish/UI | P2: consent/channel operationally inert | FIX | withdrawn/NONE delivery denial, server recorded time vs reported consent time |
| CPO-11 | H10,17,18,37 | caseDomain, m3Domain, policy/transition services | P1: arbitrary/CLOSED requirements ignored; inapplicable rules block | FIX | new stableKey, CLOSED, conditional false, genuine missing/expired blockers |
| CPO-12 | H11,38 | m3Api, payments GET | P2: permitted FINANCE read returns404 | FIX | own org financial read; no notes/docs; other tenant404 |
| CPO-13 | H12,39 | commercialQuote, publication truth | P2: zero quote publishes but cannot become contract | FIX | zero/fully discounted publish rejection; positive unchanged |
| CPO-14 | H13,49 | payment webhook configuration/service | P2: client-selected provider splits dedupe namespace | FIX | configured canonical provider, separate transactions, aliases denied, replay5 |
| CPO-15 | H14,42 | reconciliation, Case guards | P2: diagnostic not used for fail-closed transitions | FIX | injected drift prevents guarded advance; no repair writes |
| CPO-16 | H16 | contractLedgerService, quote decisions/read model | P1: mutable Quote.status cancels durable acceptance | FIX | accepted v1 after draft/review and offer expiry; obligation unchanged |
| CPO-17 | H25 | crypto, legacy lead/notes/MFA/co-session callers | P1: decrypt failure masked as empty or bad TOTP | FIX | missing/wrong key, tamper, absent vs unavailable, safe503 |
| CPO-18 | H27 | CasePartiesSection | P1: successful save throws and encourages duplicate | FIX | actual async form submit, close/refresh/retry/replay |
| CPO-19 | H28 | contract route | P2: ISSUE/SIGN ignore URL parent | FIX | unrelated/nonexistent case/version404, same-tenant owner checks |
| CPO-20 | H29 | contract input/schema | P2: unbounded immutable paymentTerms | FIX | byte/depth/key/count/type bounds, service and API |
| CPO-21 | H30 | webhook/configuration error mapping | P2: misconfiguration422 prevents retry | FIX | unavailable configuration503, wrong signature403, unknown provider404 |
| CPO-22 | H31 | M3 command keys, server-derived commands | P2: client key collides with internal command | FIX | reserved/server namespace collisions rejected before writes |
| CPO-23 | H43 | commercial draft/calculator/catalog adapter | P2: semantic transport/crew double billing | FIX | form+catalog same service publish blocker, distinct items valid |
| CPO-24 | H44 | caseService replay and unique-race recovery | P2: changed payload silently returns stale result | FIX | sequential and concurrent conflict409; same command truthful replay |
| CPO-25 | H45 | intake input/transition facts | P2: ciphertext truthiness permits whitespace deceased name | FIX | normalized whitespace rejected, decrypted guard, rollback/performance |
| CPO-26 | H46 | session, crypto, otp | P2: source-visible development signing secrets | FIX | absent key fails closed in external dev/Preview, explicit isolated test keys |
| CPO-27 | H47 item1 | password, auth callers | P2: weak generation cost, unbounded stored verification | FIX | parameters/bounds, legacy verify+safe upgrade, malformed hash rejection |
| CPO-28 | H47 item2 | login | P2: short-circuit timing enumeration | FIX | dummy work on unknown/missing hash, generic response, bounded cost |
| CPO-29 | H47 item3 | OTP request and provider boundary | P2: registered-only provider error leaks identity | FIX | equivalent outward status, no unknown-recipient sends, fail-closed verification |
| CPO-30 | H47 cookie followup | auth cookie setters | P2 pending exact remaining caller inventory | FIX if confirmed | Secure/HttpOnly/SameSite/path/lifetime consistency |
| CPO-31 | H48 | /agent/documents | P2: non-applicable rules counted as blockers | FIX | applicable-only denominator/action filter; truthful non-applicable state |
| CPO-32 | H04,32 rescan followup | documentService/scanner | P2: quarantined error has no safe retry | FIX | authorized idempotent rescan, clean vs infected/error, no bypass |
| CPO-33 | independent auth review, 2026-10-14 | platform-admin/sessions/revoke | P1: revocation request adopts a later concurrent session version | FIX / PENDING | authenticated-version CAS, cookie bound to own committed version, stale request denial and audit rollback |
| CPO-34 | independent final review, 2026-10-14 | platformFirstOrganizationAdmin | P1: actor revocation/role/MFA change after API auth is not checked by grant transaction | FIX / PENDING | locked current actor before replay/write, stale and overlapping revocation, zero unauthorized grant/audit |
| CPO-35 | independent final review, 2026-10-14 | shared operational-audit client ingresses | P2: saved views/team API can preoccupy reserved server keys | FIX / PENDING | all raw client-key boundaries reject reserved namespaces before writes |
| CPO-36 | actual authenticated browser rework, 2026-10-14 | platform organization SSR page | P2: encoded tenant IDs cause false404, blocking first-admin UI | FIX / BROWSER_PENDING | exactly one decode; malformed encoding404; encoded/bare browser navigation; literal percent identity |
| CPO-37 | independent final auth review, 2026-10-14 | auth/session, legacy API callers, parent error UI | P2: infrastructure failure masquerades as anonymous page session | FIX / BROWSER_PENDING | absent/invalid cookie vs key/DB error; safe API503; unavailable UI and recovery |

Duplicates retain all H references above. The source's cardinality proposal for
multiple PAYERs is EXTERNAL_DECISION, not an implemented single-payer restriction.
Legal document rules, Finance thresholds, actual scanner provider and human
attestations remain external; technical fail-closed behavior is still in scope.

## Verification / Release Contract

Meaningful before/after regression for each confirmed code defect; targeted
concurrency/idempotency five repeats; one final applicable local full gate and
exact-head CI, zero skipped. Independent final-diff review and new authenticated
isolated Preview UAT, not historical UAT relabelled. Intake timeout remains
unchanged; no repeated full aggregate loads reintroduced. Additive migration
only if required, with fresh encrypted backup/restore/rehearsal/no-op/parity before
Production. Protected merge without bypass, exact-SHA deployment, scoped existing
synthetic CPO smoke, reconciliation and customer-baseline qualifications.

## Working-Tree Verification Checkpoint

These are local development executions, not exact-final-SHA Preview or release
proof. No commit, merge, Production migration/configuration/write/deployment was
performed by this repair run at this checkpoint.

- Initial full unit execution: 200/201, skipped=0. The one failure asserted that
  a rejected replacement invalidated an otherwise applicable VERIFIED version.
  The corrected contract additionally rejects genuinely superseded/expired truth.
- Subsequent affected commercial/domain/boundary execution: 48/48, skipped=0.
  Includes positive publication, semantic logistics duplication, immutable
  acceptance, request bounds, new CLOSED requirement keys and condition validation.
- Canonical PostgreSQL Case file: 9/9, skipped=0; generated schema removed.
  Includes confirmed bidirectional scenario correction, concurrent same-command
  replay, changed payload conflict, whitespace rejection and full closure chain.
- First-admin PostgreSQL file: reviewer independently reported two 3/3 passes;
  five targeted repeats remain a required final gate, not yet claimed here.
- Full M3 fulfilment PostgreSQL diagnostic: 7/8. The document replacement test
  exposed an actual canonical DB-trigger mismatch. An additive repair migration
  and independent-user guard are under verification; this FAIL is not waived.
- Typecheck, lint and production build passed on an intermediate working tree.
  Final-tree full gates, authenticated Preview UAT and exact-head CI remain pending.
- Independent auth review reproduced two pre-existing MFA enrollment races:
  stale-session confirmation and an in-flight BEGIN replacing an enabled secret.
  Both are P1 rework items with conditional-write regressions in progress.

Newly identified review items stay in scope: upload/correction policy race,
historical requirement-key collision, correction deadlines, completeness of
closure projections and preservation of pre-repair contract replay fingerprints.
No previous UAT is relabelled as verification of these changes.

## 2026-10-14 Rework Checkpoint

- Five ordinary-concurrency targeted runs completed: 44/44 each, failures=0,
  skipped=0, owned-fixture cleanup PASS. Private receipt: `td-agent-cpo-gate-wYIcRX`.
  This is working-tree evidence, not an exact deployed SHA claim.
- Full local attempt `td-agent-cpo-gate-1Cwz2B`: diff, lint and typecheck PASS;
  unit 221 passed / one optional historical comparison skipped. That skip is not
  accepted as a gate PASS. The baseline comparison subsequently passed 16/16
  with the explicit pre-repair ref; its optional skip has now been removed.
- The same full attempt stopped at integration. Legacy tests still expected
  silent scenario divergence, changed-payload replay and old internal command
  keys. Expectations were aligned with explicit correction, payload conflict and
  server-derived keys, retaining immutable-history and side-effect counts.
- Affected recheck: publication 3/3 and intake/performance 18/18, skipped=0.
  The remaining rollback-test expectation was corrected from raw Prisma P2002
  to the bounded runner's safe 409; all rollback-state assertions remain.
  A fresh full local run is in progress; no final PASS is claimed here.
- Component browser checks passed on desktop/mobile with real React components
  and mocked transport, including the actual synthetic PDF response/download.
  This is not authenticated Preview, storage-provider or production-scanner proof.
- Preview branch rebinding returned HTTP 400, with no secret values printed.
  Metadata inspection showed all fourteen overrides still on the previous branch.
  No new branch push/deployment is allowed to inherit global Production DB config.
- Production main/runtime remain `87550178d6b4ba60b3f752880fd08674c6fd2835`;
  no Production writes, configuration, migration or deployment in this repair run.
  Human verdicts remain PENDING and broad rollout remains restricted.

### Subsequent Local And Preview Results

- Local receipt `td-agent-cpo-gate-J9r7C7`: diff/lint/typecheck PASS,
  unit 222/222 and PostgreSQL integration 134/134 across twenty files, skipped=0.
  Legacy fixture, migration/no-op/parity, build and encrypted synthetic restore
  passed. Actual restored synthetic counts/digests matched; clone cleanup PASS.
- E2E in that attempt: Agent/Manager, Platform/Organization Admin and M2 commercial
  sequences passed. M3 stopped at HTTP403 because the new local runner supplied
  the repair branch instead of the existing explicitly allowed isolated CI
  context. The runner was corrected to match CI; production authorization was
  not relaxed. Final E2E PASS remains pending.
- Independent review confirmed an additional pre-existing P1 in session revoke:
  an authenticated version8 request could commit9 and then mint a cookie10 after
  another revocation. CPO-33 tracks the repair and regressions; not waived.
- Vercel failure cause was safely classified as BRANCH_NOT_FOUND. A documented
  Preview-only deployment pause allowed creation of the remote repair branch at
  base875, binding of fifteen Preview overrides, then restoration of the prior
  pause setting. Production deployment and environment metadata were unchanged.
- Fresh owned Railway Preview schema `m3_cpo_repair_1791965196783` was created
  on fingerprint545a187f9e9d66b0 (not Production0257665af2dd90a4). Its migration,
  repeated no-op, parity and synthetic M3 fixture passed. Existing unknown data
  were not deleted or adopted. New exact-runtime authenticated UAT is pending.

### Backup Rehearsal And Additional Security Repair

- CPO-33: authenticated-version CAS now binds the new cookie to that transaction's
  own increment. Five isolated PostgreSQL runs passed 7/7 each; the extended
  file subsequently passed 9/9, adding missing-key and post-commit signing-failure
  checks. Independent source review reported P0=0/P1=0 for this repair.
- Two fresh read-only backup attempts stopped during encryption. Safe diagnostics
  identified GPG_AGENT_UNAVAILABLE, not a database/migration failure. A synthetic
  long-versus-short-home test reproduced exit2 on the long Unix socket path and
  successful encryption/decryption on the short private path. Own agents stopped
  and temporary self-test directories cleaned. No timeout/security reduction.
- Reviewed adapter rehearsal subsequently passed using a single exported read-only
  source snapshot for manifest and dump. Production fingerprint0257665af2dd90a4,
  fifty-two tables, encrypted archive SHA256
  `05fb05b0891e080e6cb176e464ea9ccbe07e50a780dcfc07c6c7eafa5d3bb623`.
  Separate private key retained; no plaintext dump file.
- Actual isolated local restore: old migration no-op/parity PASS; exactly the two
  approved repair migrations applied; repeated no-op and schema/catalog parity
  PASS; all old-column counts/digests, including security buckets, MATCH; old
  migration history unchanged; restored requirements retain null supersededAt.
  Clone sequences were preserved across migration; source sequence snapshot
  parity is explicitly NOT_CLAIMED. No TCP listener. Clone stopped and removed.
- Private receipt:
  `cpo-repair-2026-10-14T08-33-16.894Z-27b91c01178865ef/receipt.json`.
  This proves rehearsal, not Production migration/deployment approval or execution.

### Browser Rework Checkpoint

- Receipt `td-agent-cpo-gate-XkXoOv`: unit222/222, PostgreSQL143/143,
  skipped=0, plus legacy/migration/no-op/parity/build/restore PASS. M3 browser
  sequence stopped because Finance B's separate configured seed was not consumed
  by the fixture. The fixture now supports and validates that override, retaining
  fallback compatibility when no B override is supplied. Production MFA unchanged.
- Subsequent browser-only receipt `td-agent-cpo-gate-Od2YIA`: all existing M1/M2
  and full M3 browser sequences passed. M3 included both scenarios, quarantine/
  review/replacement, immutable obligation, partial/full/refund/reversal,
  five webhook deliveries with one entry, lost-response replay, role/privacy/
  tenant checks, accessibility/mobile and reconciliation0; unexpected5xx=0.
- The additional CPO browser sequence stopped on the initial first-admin heading.
  That new flow is not marked PASS. Its navigation/data cause is under diagnosis;
  no timeout increase or removal of the expected control.
- Independent review found CPO-34 and CPO-35. Both remain release blockers until
  repair/regressions/review, regardless of earlier green suites. Fixture Base32
  length and protected Playwright-input diagnostics are also being tightened.

### Subsequent Security And Navigation Verification

- CPO-34 now locks Organization then current actor User before replay or grant,
  validating the database session version, SUPER_ADMIN role and enabled MFA.
  Five PostgreSQL runs passed 7/7 each, skipped=0, cleanup PASS; focused unit and
  protected-input checks passed 13/13. Independent source review found no P0/P1.
  Receipt: `cpo-firstadmin-five-GD59Xn/receipt.json`.
- CPO-35 rejects reserved namespaces at all identified raw operational-audit
  client ingresses. Meeting escalation child audit keys now use the reserved
  server namespace, with a regression that preoccupies the former child key.
  Five targeted runs passed 5/5 each; operations15/15 and focused units10/10
  passed. Independent review found no P0/P1. Receipt:
  `td-cpo-meeting-child-final-XCJJzo/receipt.json`.
- Session-revocation and logout controls now expose truthful retry/reauthentication
  feedback and remain available on mobile. Independent source/secret-policy
  review found no concrete P0/P1/P2; protected-input policy4/4 passed. Browser
  evidence for injected failures is explicitly mock-only, not backend proof.
- Local receipt `td-agent-cpo-gate-1zoP9l`: diff/lint/typecheck, build,
  migration/no-op/parity and actual encrypted synthetic restore PASS. Additional
  CPO browser flow again stopped before any ADMIN grant: organization page404,
  diagnostic API401. The screenshot contains only a generic404. Cause remains
  under diagnosis; this is not a UAT PASS. Owned schema/clone cleanup PASS.
- Subsequent full unit invocation passed231/231, skipped=0. Full canonical
  PostgreSQL integration completed152/152 across22files, failures=0, skipped=0,
  exit0; all22owned schemas dropped. Private execution log:
  `/tmp/td-cpo-repair-final-integration-20261014.log`. No exact-final-SHA CI,
  Preview UAT, merge or release is claimed.
- Read-only serving-state recheck: Production remains READY at87550178 with
  deployment `dpl_8rqT8aRp2x75wfxHVpmJBaMigytY`; freeze exact disabled and
  login page200. Production writes/configuration/migrations/deployments by this
  repair run remain NONE. Human verdicts PENDING; broad rollout restricted.
- Final source review additionally identified a pre-existing P2 availability
  classification gap: agent page authentication can mask infrastructure failure
  as an anonymous session. This is not an authorization bypass. Its scoped
  repair is pending; anonymous/invalid-cookie behavior must remain unchanged,
  and unavailable UI must not claim that a page returned HTTP503 without proof.
- CPO-36 root cause confirmed by two independent owned-local diagnostics:
  `cpo-navigation-diagnostic-PBkAy1` and `cpo-navigation-diagnostic-6tXq74`.
  Chromium sends the Secure cookie and browser-origin API returns200 with the
  expected synthetic organization, but unmodified SSR returns404. Query tracing
  found an encoded identifier at the SSR lookup; one-decode in-memory diagnostic
  normalization yielded200 and the expected control. The page now decodes once,
  rejects malformed encoding, and retains literal-percent identity. Focused page/
  harness tests16/16 passed. Final browser verification is running, not yet PASS.
- The diagnostic API401 was a separate local harness issue: Playwright APIRequest
  and URL-filtered cookie inspection omit Secure cookies on HTTP loopback, while
  Chromium sends them correctly. Authenticated harness requests now use browser
  same-origin fetch and logout inspects the unfiltered jar. Production Secure
  cookie settings were not relaxed.
- CPO-37 scoped repair: key acquisition propagates infrastructure failures,
  anonymous/invalid-session behavior remains intact, eight affected API handlers
  use existing safe error mapping, and a parent boundary exposes a generic reload
  UI. Focused tests45/45 and independent tests8/8 passed; source review found no
  blocker. A local/CI-only real missing-key process and recovery browser test was
  added; execution remains pending. Its preflight/target/cleanup P2 findings were
  repaired before execution; malformed-URL secret-policy tests5/5 passed.

### October 15 Continuation

- Remote main and repair branch still point to87550178d6b4ba60b3f752880fd08674c6fd2835.
  The runtime repair is an uncommitted working tree, not an exact-SHA release.
- Owned local receipt `cpo-navigation-diagnostic-5nSqar` passed the additional
  CPO functional browser sequence and real missing-key/recovery browser check,
  skipped=0 and cleanup PASS. This reused the previously built local artifact;
  it is not authenticated deployed Preview UAT.
- Subsequent viewport assertions reproduced serious contrast findings and
  narrow-viewport navigation/email clipping. The minimal contrast/wrapping
  repairs are applied; rebuilt acceptance is pending. Private diagnostic receipt:
  `cpo-firstadmin-ui-diagnostic-nvqDj3/receipt.json`.
- Legacy E2E failure-output regressions passed3/3, covering all four actual
  scripts' startup, journey and cleanup exceptions. Two adjacent secret-policy
  subprocess checks timed out locally at their unchanged10-second limit, twice.
  Host load average was230.31 during diagnosis. They remain FAIL pending cause
  verification; neither timeouts nor assertions have been increased or weakened.
- One final-tree local full gate and fresh independent reviews are in progress.
  No new CI/Preview/merge/Production PASS is claimed. Human verdicts remain
  PENDING and broad rollout remains restricted.
- An unbounded diagnostic exited1 after11963ms with the expected static message
  and no canary leakage. Browser and Prisma imports were deferred until after
  preflight. The unchanged10-second subprocess regressions subsequently passed
  5/5, skipped=0; malformed-URL checks completed in667ms. This changes test
  startup only, not application timeouts, DB guards or authentication semantics.
- Receipt `td-agent-cpo-gate-Plc9JM` was deliberately interrupted during lint
  before DB/build work to apply that repair; owned-child termination and cleanup
  PASS. It is not a lint or full-gate PASS. A new full-tree run has started.
- Initial committed repair `920035b6391ea43700e89ce0f7e5239072e6bc0e` is in
  Draft PR36. CI38704803053 failed lint on the test-local identifier `module`;
  later steps were skipped, not passed. The matching local gate `tudDQG` also
  failed lint and cleaned its owned resources. Validator was not disabled.
- Preview `dpl_Gz6Z2qqsHEMLNVYydY2iKzTYMq3c` is READY on920035b. No UAT is
  claimed for it; subsequent independent findings require a new runtime.
- Independent review of920035b found a remaining execution-confirmation P1:
  consistent refund history can leave an outstanding balance after entry into
  EXECUTION. Current contract/document/payment guards are now added to that
  event; both-scenario domain tests6/6 pass. PostgreSQL/API refusal, atomicity,
  repayment and replay verification is pending.
- The same review found a partial-intake P2: an initially blank name prevented
  unrelated fields from being saved. Empty/whitespace input now normalizes to
  null; it must not complete intake. Both-scenario API regressions are pending.
- Separate independent review reproduced unowned asynchronous E2E interception
  failure leaking a synthetic header, abandoned response-waiter rejections, and
  an activation screenshot containing synthetic MFA material. These are active
  rework items, not waived or declared PASS by earlier formatter tests.
- Live read-only Production check remains87550178 / dpl_8rqT8aRp2x75wfxHVpmJBaMigytY,
  READY, login200, freeze disabled. Historical backup/migration fields from that
  status helper are not a fresh release preflight.
- New refund/execution and partial-intake API/PostgreSQL regressions completed
  five ordinary-concurrency runs:31/31 each (finance9, intake22), skipped=0,
  failures=0, both owned schemas dropped after every run. First receipt:
  `cpo-execution-refund-Gg16Ct`; remaining four:
  `cpo-execution-refund-repeat-vvht9P/receipt.json`.
  Repeated rejected execution requests preserved Case/events/tasks/audit; restored
  payment coverage allowed one confirmation and truthful side-effect-free replay.
  Both scenarios retained partial forms with null normalized names and no false
  intake completion. Independent narrow review found no further concrete defect;
  it ran domain6/6 and schema probes, not these PostgreSQL executions.
