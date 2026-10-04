# Limited CPO Audit Release, 2026-10-04

This is the authoritative post-release record for the synthetic CPO audit only.
Full-agent rollout remains CLOSED / PENDING_HUMAN_VERDICTS. Finance, Legal/Privacy
and Ritual SME verdicts are unsigned and PENDING. No professional sign-off is claimed.
M4 has not started.

## Exact Source and Release

- Initial M3 merge: PR #32, `c9e8a9373d10e1e2c1b2f2d6a4bcbb49654e7de1`.
- Intake repair source: `4bc03e2f228d64f9d12325cfe21b683ee143d5a1`;
  PR #33 merge: `8deda6c3dbeb79dd15f3897a44ee16a492f55cca`.
- Reconciliation repair source: `c0567d11d4a80d1488a1e8bca6dc1815ffc83806`;
  evidence head: `e2c31ca1d1a54592c86bf3b3435eed60e0f5841a`;
  PR #34 merge: `9071393f9f3539d1df9fd61d645e34dd548eeb4a`.
- Final PR CI: https://github.com/gorgerich/TD_agent/actions/runs/37198451567,
  overall PASS. Main CI: https://github.com/gorgerich/TD_agent/actions/runs/37199362950,
  overall PASS. Test skipped=0. The conditional failure-diagnostics step was
  intentionally not invoked because E2E passed; that is not a skipped test.
- Serving deployment after controlled unfreeze:
  `dpl_5gcgvFzauaTUCWUDL13AwXFhUSFG`, source `9071393f9f3539d1df9fd61d645e34dd548eeb4a`,
  https://td-agent-nl72lwl5m-rics-projects-9baa2793.vercel.app,
  alias https://td-agent.vercel.app, READY.
- Exact-source full Preview UAT remains bound to `c0567d11d4a80d1488a1e8bca6dc1815ffc83806`,
  `dpl_AkHmeuGd4EoQJVTPqEH3qpCeKgUa`, DB fingerprint `545a187f9e9d66b0`,
  private store `store_Ov8erHstuvfJ52Og`. Both full journeys passed; no old UAT was relabelled.
- Final evidence-head Preview `dpl_CTNMxZQt9L26WzDt3947dVRwJJjp` was READY with
  authenticated role reads. Runtime tree equivalence was checked; it is not a new full UAT claim.

## Root Causes and Timing

Original intake failed with Prisma P2028 at 5074ms against the unchanged 5000ms
transaction deadline. Five full aggregate loads and repeated guards/locks caused
76 SQL operations and six row locks. The intake repair reduces these to 28 SQL
operations and three row locks, retaining atomic intake, transitions, requirements,
projections and audit, lock ordering, tenant guards and truthful replay.

App region is iad1; Railway DB is us-west2. Historical per-query/lock wait telemetry
was not captured. Read-only Mac RTT is not claimed as Vercel-to-DB RTT. The 80ms
isolated latency regression is conservative injected latency, not fabricated
Production tracing. Production intake HTTP timings were 4402ms (cremation) and
4038ms (relative burial); these are end-to-end HTTP durations, not internal
transaction durations. The 4402ms cremation measurement belongs to the prior
`8deda6c3dbeb79dd15f3897a44ee16a492f55cca` run; on `9071393` its committed
workflow was resumed with read/guard/reconciliation verification, not repeated.
The burial 4038ms measurement is the fresh `9071393` intake. Five targeted CI latency runs passed; historical local
outliers remain documented, not rewritten as five local passes.

Production continuation found a second defect: a missing optional document relation
was compared as `undefined !== tenantId`, producing two false DOCUMENT_TENANT_MISMATCH
findings. The narrow presence guard fixes absence without relaxing ownership or
verified-document readiness. Both-scenario regression covers missing, quarantined
and genuinely foreign documents. Incident/rollback history is preserved in
reconciliation-incident.md.

## Backup, Migration and Isolation

Production fingerprint: `0257665af2dd90a4`. Railway TD Agent project
`204385e0-1f5d-4711-ac49-74475d0d7093`, environment
`3bdb2bf1-62cf-4d92-80d7-ca762c607fbc`, Postgres service
`32492019-8037-4443-807b-3919626ccc63`. NOX is excluded by prior read-only
endpoint/service/volume isolation proof; no NOX data/configuration was accessed here.

Fresh encrypted backup and actual restore receipt:
`intake-2026-10-04T11-05-23.102Z`; encrypted archive SHA256
`2826076073ad315e070a2f784d756917431c608e8f09644ba5c8a69ded166193`.
Archive and separate key have owner-only permissions. All 52 table counts/digests
matched, schema parity PASS, restore-clone migration deploy NO_OP. Owned plaintext
clone was stopped and removed; encrypted archives/keys and retained restore resource
remain retained. Volatile SecurityRateLimitBucket is explicitly excluded from
business-baseline comparisons, not financial/document history.

M3 migration `20260811172829_m3_fulfilment_money_trust` was already applied by the
owner runner, duration 164682ms, no-op/parity PASS. Neither hotfix changes schema,
migrations or approved historical checksums. No manual reapplication or destructive
schema rollback was performed. Runtime rollback target remains source
`20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`, rebuilt READY as
`dpl_4sFF8Boy1yHkyx2kbb8N3GXVySwo`; runtime rollback is not DB rollback.

## Production Smoke and Retention

Existing organization only: `m3-cpo-audit-20260923`; Users 224-228, Agents 234-238,
roles Agent, Manager, Document Reviewer and two Finance actors. No new tenant,
User or Agent was created by the hotfix smoke. API mutations were limited to this
server-allowlisted synthetic organization. Real organizations cannot execute M3
financial/document/signing writes. No external payment, message or real document
was sent. Synthetic contract evidence is not a legal signature or human verdict.

Frozen deployment `dpl_9UPQTioDz5iXWXiEPNqqL5FLsMnj` served exact merge SHA:
five logins/protected reads/RBAC/cross-tenant denial PASS, mutation returned503.
Only after main CI and frozen smoke passed, Production-only freeze was set disabled
and the same source was rebuilt. Runtime header is absent on the serving deployment.

Production API smoke PASS on `9071393f9f3539d1df9fd61d645e34dd548eeb4a`:
resumed cremation verification of existing committed history plus a fresh burial
journey, not two newly repeated mutation pipelines on this SHA.
176000 RUB obligation; 88000 partial payment gives PARTIALLY_PAID with 88000 balance;
remaining payment gives PAID with zero balance. Idempotent intake/publish/payment
replay is truthful. Burial refund/reversal preserve original entries; self-approval
is403 and second Finance actor approves. Five signed synthetic webhook calls yield
one ledger entry, one receipt, one original response and four replay responses.
Both Case reconciliation counts and operational reconciliation are0; unexpected5xx=0.

Retained cremation: Lead57, Case `case_16785ce6b182455ca421fdab8f18cd74`, Meeting50,
Quote38, Published Version44, contract `cmutohs49001dddn04kbp0lb6`, obligation
`cmutohv2b001pddn0emqzgq3y`, document version `cmutoidmu002pddn0tm7ag8dz`.
Retained burial: Lead58, Case `case_5c53d4618c8646d5b64980c143b8e797`, Meeting51,
Quote39, Published Version46, contract `cmutrsavm001wyr9g74g851nd`, obligation
`cmutrsdtx0028yr9gs6dxoxbp`, document version `cmutrth51004eyr9ggq1lhbhg`.
These synthetic records and append-only financial/document/audit history remain for
CPO reproduction; they are not deleted as cleanup. All created public client links
are REVOKED. Operator cookies were discarded/logged out. CPO accounts intentionally
remain ACTIVE for authorized handoff; no claim that all CPO access is suspended or
all issued JWTs were version-revoked is made.

Production malware provider is absent: uploads remain QUARANTINED / scan ERROR,
review initiation409, private read404 and execution422 GUARD_FAILED. This is a
tested fail-closed boundary, NOT successful Production malware scanning or verified
documents. Full verification/replacement journeys passed only in isolated Preview.

## Remaining Final Checks

Post-smoke read-only business baseline: all 34 checked customer-table counts/digests
MATCH, real customer records changed0, tenant ownership checks PASS. Only the exact
CPO organization/accounts and the explicitly volatile security bucket table are
excluded. Owned synthetic Case57 retains seven events, one meeting/quote, three
requirements and three ledger entries, confirming no repeated cremation side effects.

Four-role UI page reads passed on desktop/mobile and a 640x450 effective CSS viewport
for 1280x900 at 200% reflow. The initial CSS `zoom:2` capture check missed clipped
descendants; those old captures remain historical, not native browser zoom PASS.
Additional real read-only clicks PASS: Agent/Manager open Case57, Finance opens and
closes the ledger, Reviewer switches queue filters. All 12 role/viewport combinations
passed, unexpected5xx=0. Bottom-scroll screenshots were visually inspected: final
Case rows and Finance controls are reachable above the fixed bottom navigation.
An initial click check raced soft navigation; waiting for the actual URL fixes the
external harness without timeout increases or application code changes. Vercel CLI
authorization expired during continuation (403), then refreshed normally via CLI;
this is not counted as a Production application failure. No universal UI/anti-slop compliance
or exhaustive native browser zoom certification is claimed.

## Open Risks and Honest Scope

- Finance/Legal/Privacy/Ritual verdicts PENDING; full-agent rollout CLOSED.
- Production scanner provider absent; verification remains fail-closed.
- M3-P2-FINANCE-CASE-DETAIL-READ: Finance org workspace works, but Case-detail
  payment read retains owner restriction. Owner M3 engineering, due2026-10-04 or
  before broad rollout. No new cross-tenant permission is introduced.
- M3-P2-PAYMENT-STAGE-LABEL: Case registry calls all PAYMENT-stage cases waiting
  for payment even when ledger balance is0 and missing verified documents block
  execution. Static source and fresh synthetic Production screenshots confirm this
  operational projection ambiguity. Ledger amounts/guards remain canonical. Owner
  M3 engineering, due2026-10-06 or before broad rollout; accepted only as a visible
  CPO-audit limitation, not financial truth.
- GitHub main classic protection returned404 "Branch not protected" and active
  branch rules returned[]. Exact-head green gates were manually checked before
  ordinary PR merge with match-head; no admin bypass/force was used. Repository
  owner should configure required-check enforcement before broad rollout.
- RISK-W1-TECH-HUMAN-REVIEW remains OPEN.

The pre-release `test-results.json.production` section is explicitly historical
technical-validation scope, not a claim that this release had no Production writes
or deployments. This post-release record supersedes its current-state interpretation.

## Audit Scope and CPO Handoff

Checked: the exact narrow source diff/callers, intake atomicity/replay/latency gates,
reconciliation ownership/readiness regression, canonical CI and isolated full Preview
journeys, actual frozen and unfrozen Production role/API smoke, partial/full/refund/
reversal/webhook history, private quarantine boundary, both Case guards/reconciliation,
cross-tenant denial, 34 customer-table digests and four-role responsive page/control access.

Not claimed: exhaustive fresh audit of all legacy endpoints or the unavailable old
45-item HTML checklist; all-application anti-slop redesign compliance; native browser
zoom certification; actual Production malware scanning/verification; legal signing or
accounting/ritual approval; historically uncaptured SQL/lock telemetry. These omissions
are explicit limitations, not converted to PASS or fictional human signatures.

CPO entry https://td-agent.vercel.app/agent/login. Agent/Manager /agent/cases;
Reviewer /agent/document-review; Finance /agent/finance. Local owner handoff:
`TD-Agent-M3-Operator/CPO-AUDIT-HANDOFF.md`; passwords and synthetic Finance MFA
material remain separate owner-only local files, never evidence/chat/PR. Owner transfers
selected synthetic access through the agreed protected channel. Existing synthetic
records remain visible for audit; full-agent rollout and M4 remain closed.

The evidence closure commit/PR and its CI are separate from runtime merge907. A later
docs-only main merge can have a different deployment SHA but must have an identical
runtime tree. Final handoff must report that exact serving SHA rather than call it907.
