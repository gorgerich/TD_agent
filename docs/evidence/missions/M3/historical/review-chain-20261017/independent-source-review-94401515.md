# Independent Adversarial Source Review

Recorded: 2026-10-16. This is an external review receipt, not authoritative mission evidence or release authorization.

## Binding And Verdict

- Base: `87550178d6b4ba60b3f752880fd08674c6fd2835`.
- Reviewed runtime: `944015151be81a241956a077ebda62ee0d53d61b`.
- HEAD and clean working tree checked at the beginning and end of source inspection.
- Scope: cumulative runtime repair, auth, documents, money, scenario/Case guards, additive migrations, harness, validator and Parties changes. Git delta contains 139 changed paths. Original HTML parsed structurally: 49 digrow records, including hidden-tab content. Registry contains 37 canonical rows. Original descriptions contain truncation; no missing text was invented.
- No newly established P0/P1 runtime defect. No unclosed concrete runtime P2 established in the inspected repair paths.
- Review closure is NOT complete: two P2 regression gaps below remain, and the authoritative packet is stale. No exact-head CI, deployed Preview UAT, Production or human PASS is claimed.

## Open Findings

### R944-01: P2, CPO-09 has no targeted server regression

`lib/casePartyService.ts:137-148` rejects removal of a contract-bound PAYER role; ISSUE/SIGN also recheck the role and reconciliation reports CONTRACT_PAYER_DRIFT. Source implementation is present, but searches across tests found no exercised removal after ISSUED/SIGNED, no ISSUE/SIGN denial after role drift, and no assertion of CONTRACT_PAYER_DRIFT. The existing role-removal tests concern conditional document applicability, not contract-bound PAYER. Generic mocked 409 UI recovery does not verify the server business guard.

Required: canonical service/API negative cases for issued and signed contracts with unchanged party/role/audit state; positive unbound role change and multiple-payer preservation; ISSUE/SIGN drift denial and reconciliation assertion. Include a concurrent issue/removal boundary if claiming race closure.

### R944-02: P2, CPO-10 delivery guard has no targeted server regression

`lib/commercialQuoteService.ts:378-389` requires a same-case consenting recipient with matching EMAIL/MESSENGER channel and contact. No test references recipientPartyId or exercises this server publication branch. WITHDRAWN browser fixtures only test rendering. Consent audit preservation is covered separately and does not cover publication authorization.

Required: missing/foreign/wrong-case recipient, withdrawn/restricted/unknown consent, NONE/mismatched channel and missing contact must reject with no publication/decision/Case/audit writes. Positive email/messenger publication and matching replay must succeed; changed recipient with the same command key must conflict. Preserve link publication and no automated real outreach.

### R944-03: P2, authoritative evidence remains bound to PR34

`docs/evidence/missions/M3/mission.yaml:5-9`, `test-results.json:4-14`, `human-signoffs.json:5-7`, and `review.md:3` still identify c0567/PR34/old CI/old Preview. The registry's CPO-33..37 states and CPO-25 whitespace wording also lag current implementation. These are historical evidence, not proof for PR36/944. Synchronize candidate, source CI, actual Preview UAT, independent review, migration/backup and human packet fields only from actual final evidence, preserving prior history. Do not relabel old smoke or human signatures.

## Evidence Classification

- S = implementation inspected; targeted executable regression present. This does not mean every regression was independently executed here.
- G = implementation inspected; targeted server regression gap remains.
- X = external decision/provider remains open, while technical fail-closed behavior is inspected.
- Test paths below are relative to `/Users/silkwayrally/Documents/Codex/TD_agent_m3_audit_repair`.

## Registry Cross-Map

| ID | Original HTML | Current source mechanism | Regression and current status |
| --- | --- | --- | --- |
| CPO-01 | H01,19-22,26 | m3Domain balance-based coverage; refunds/adjustments refresh fulfilment; read model matches ledger | S: cpoAuditMoney.test.ts; cpoAuditBoundary.test.ts; integration/cpoAuditFinance.itest.ts overpayment/refund/repayment/closure and current-execution refund rejection |
| CPO-02 | H02,15,23 | platformFirstOrganizationAdmin; strict SUPER_ADMIN/MFA/confirmation, tenant/bootstrap locks, current actor check | S: cpo02FirstOrganizationAdmin.test.ts; integration/cpo02FirstOrganizationAdmin.itest.ts; e2e/cpo-repair.mjs actual grant/replay/invite path |
| CPO-03 | H03,36 | obligation-wide cumulative corrections under transaction/obligation serialization | S: integration/cpoAuditFinance.itest.ts cumulative sources and concurrent threshold crossing; existing source-capacity/four-eyes assertions retained |
| CPO-04 | H04,32 | operational scanner preflight, MIME/body bounds, upload policy/type recheck; old VERIFIED preserved | S+X: cpoAuditDocuments.test.ts; integration/cpoAuditDocuments.itest.ts; real production scanner still absent/external |
| CPO-05 | H05,33 | m3PolicyActivation validates supported conditions and REQUIRED/CONDITIONAL consistency | S: m3Domain.test.ts condition matrix and extensible CLOSED keys; integration/cpoScenarioCorrection.itest.ts |
| CPO-06 | H05,24,33 | explicit confirmed pre-consequence correction, pinned policy/requirements, atomic lead/scenario/event changes | S: integration/cases.itest.ts; integration/cpoScenarioCorrection.itest.ts bidirectional correction, historical collision, deadline, rollback, upload/publication overlap |
| CPO-07 | H06,34 | user-identity review separation in service and DB; expiry validation; immutable review/supersession authorization | S: cpoAuditDocuments.test.ts; integration/cpoAuditDocuments.itest.ts same user/different membership, direct DB denial, forged config denial, expiry/replay |
| CPO-08 | H07,35 | escalation rejects closed task/missing owner and audits prior task state | S: cpoAuditDocuments.test.ts; integration/cpoAuditDocuments.itest.ts open/closed/owner/replay cases |
| CPO-09 | H08,40 | contract-bound payer-role removal blocked; ISSUE/SIGN/reconciliation current-role checks | G: R944-01, do not mark independently regression-closed |
| CPO-10 | H09,41 | recipient consent/channel/contact guard; reported consent timestamp and audit registration time distinguished | G: consent audit exercised in integration/m3Fulfilment.itest.ts; publication branch needs R944-02 |
| CPO-11 | H10,17,18,37 | applicable policy-complete document truth drives execution and closure, not five fixed stable keys | S: caseDomain.test.ts; cpoAuditBoundary.test.ts; integration/cpoScenarioCorrection.itest.ts missing CLOSED row/readiness; m3Domain.test.ts extensible/conditional rules |
| CPO-12 | H11,38 | explicit financial case-resolution scope; FINANCE money read without broader operational scope | S: integration/cpoAuditFinance.itest.ts peer-owned GET/no PII/tenant/owner/MFA boundaries |
| CPO-13 | H12,39 | non-positive total rejected before publication | S: commercialQuote.test.ts zero and fully discounted totals, positive controls retained |
| CPO-14 | H13,49 | configured canonical provider; route/service reject aliases; signed and bounded raw body | S: cpoAuditBoundary.test.ts; integration/m3Fulfilment.itest.ts webhook dedupe, signatures, bounded request and immutable ledger assertions |
| CPO-15 | H14,42 | guarded execution/payment/closure invokes read-only reconciliation; discrepancies reject | S: integration/m3Fulfilment.itest.ts injected discrepancy blocks transition; integration/cpoAuditFinance.itest.ts truthful reconciliation |
| CPO-16 | H16 | immutable accepted decision replaces mutable Quote.status; signed obligation survives newer unaccepted quote/offer expiry | S: cpoAuditBoundary.test.ts; integration/cpoAuditFinance.itest.ts accepted SUPERSEDED/EXPIRED historical truth, replacement-signing atomicity; integration/m3Fulfilment.itest.ts |
| CPO-17 | H25 | active PII/MFA/co-session paths use strict decrypt; auth infrastructure errors propagate safely | S: crypto.test.ts, authCrypto.test.ts, authRoutes.test.ts, authInfrastructure.test.ts; source search found no active app/lib lenient decrypt callers outside compatibility definitions |
| CPO-18 | H27 | captured form node; retained command body/key; acknowledged create/update; canonical read-back and recovery | S: caseParties.e2e.mjs desktop/mobile/195px, no optimistic submitted truth, malformed ack/lost transport/409/retry, delayed SSR/read and case disposal |
| CPO-19 | H28 | contract URL parent validated for CREATE/ISSUE/SIGN, including replay; legacy semantic fingerprint retained | S: integration/cpoAuditFinance.itest.ts pre-upgrade ISSUE/SIGN replay, mismatched parent/payload denial and unchanged write counts |
| CPO-20 | H29 | streaming request byte limit; bounded JSON paymentTerms depth/nodes/keys/types/bytes at route and service | S: cpoAuditBoundary.test.ts bounds and UTF-8; contract API uses bounded parser |
| CPO-21 | H30 | missing webhook configuration returns retryable 503; signature/provider distinctions remain | S: cpoAuditBoundary.test.ts provider absent/aliases/secret configuration matrix |
| CPO-22 | H31 | raw client keys reject reserved namespaces; server-derived hashed keys isolated | S: cpoAuditBoundary.test.ts, cpoCommandNamespace.test.ts, integration/cpoCommandNamespace.itest.ts ingress/no-write/normal replay/historical child-key compatibility; lead ingress in integration/cpoAuditFinance.itest.ts |
| CPO-23 | H43 | canonical logistics service identity detects calculator/catalog duplicate counted services | S: commercialQuote.test.ts duplicate and seat-qualified renamed transport, positive distinct/replacement controls |
| CPO-24 | H44 | Case replay compares canonical payload/fingerprint, including unique race; commercial decision comments bound | S: integration/cases.itest.ts, integration/cpoScenarioCorrection.itest.ts, integration/m3IntakePerformance.itest.ts, integration/commercialQuotes.itest.ts |
| CPO-25 | H45 | intake schema trims blank to null for partial saves; decrypted trim prevents completion | S: caseDomain.test.ts; integration/m3IntakePerformance.itest.ts four both-scenario empty/whitespace partial-save/replay cases; integration/cases.itest.ts strong null/INTAKE/UNSELECTED/no-completion checks. Registry wording must not say partial saves reject whitespace |
| CPO-26 | H46 | no source-visible fallback session/encryption/OTP signing key; absent/blank key fails closed | S: authCrypto.test.ts all NODE_ENV variants, compatible enc1/OTP derivation, tamper; authRoutes.test.ts |
| CPO-27 | H47 item 1 | 600k creation, bounded stored hash parser/max cost, encoded-salt legacy compatibility and CAS upgrade | S: password.test.ts; authRoutes.test.ts legacy upgrade/reset/revocation races and long legacy password |
| CPO-28 | H47 item 2 | verifier runs for absent/passwordless/malformed hash; bounded failed-login KDF budget | S: password.test.ts work-budget tests; authRoutes.test.ts generic failures/rate limits; not a universal side-channel elimination claim |
| CPO-29 | H47 item 3 | recipient-independent OTP response/config checks; asynchronous bounded delivery; consume-once verification | S: authRoutes.test.ts lookup/delivery after response, no unknown-recipient send, provider failure, concurrent token consumption |
| CPO-30 | H47 cookie follow-up | shared setAgentSessionCookie protections and logout clearing same scope | S: authCrypto.test.ts flags; authRoutes.test.ts logout/demo cookies. Source search found one SESSION_COOKIE setter in agentAuth.ts |
| CPO-31 | H48 | documents worklist excludes non-applicable/superseded requirements; canonical verified version shown separately from pending replacement | S: cpoAuditDocuments.e2e.mjs, cpoAuditDocuments.test.ts; case/document projections inspected |
| CPO-32 | H04,32 follow-up | authorized immutable explicit rescan, retains original uploader, stale/infected/owner/tenant denial | S+X: cpoAuditDocuments.test.ts; integration/cpoAuditDocuments.itest.ts; component rescan regression. No real scanner readiness claim |
| CPO-33 | later independent review | revocation CAS on authenticated version/current owner/MFA; sign only own committed version | S: integration/cpoSessionRevocation.itest.ts commit/sign overlap, concurrent winner, rollback and signing failure; historical failure retained |
| CPO-34 | later independent review | first-admin current actor locked/rechecked before replay or grant | S: cpo02FirstOrganizationAdmin.test.ts; integration/cpo02FirstOrganizationAdmin.itest.ts stale role/version/MFA, overlapping revocation and zero unauthorized audit/grant |
| CPO-35 | later independent review | all identified shared-audit raw header ingresses apply namespace boundary | S: cpoCommandNamespace.test.ts; integration/cpoCommandNamespace.itest.ts zero-write negatives and unchanged positive replays |
| CPO-36 | later browser rework | organization SSR parameter decoded exactly once; encoded/bare IDs work, malformed/literal percent identities separated | S: cpoOrganizationPage.test.ts; e2e/cpo-repair.mjs authenticated navigation |
| CPO-37 | later auth review | absent/invalid sessions distinct from missing-key/DB errors; safe API503 and unavailable/recovery UI | S: authInfrastructure.test.ts; e2e/cpo-auth-infrastructure.mjs; no development synthetic auth fallback |

All H01-H49 references are represented above. Duplicate HTML rows are not counted as independent defects. Multiple PAYER cardinality is an external policy decision, not silently prohibited.

## Additional Findings And Follow-Up Repairs

- Execution-after-full-refund P1: repaired by current contract/document/payment facts on execution.confirmed; caseDomain.test.ts tests both scenarios and three negative facts. integration/cpoAuditFinance.itest.ts:254 asserts repeated API422 with unchanged Case/events/tasks/audits, repayment success and truthful no-effect replay.
- Partial-form whitespace P2: repaired without weakening decrypted completion guard; four added PG/API cases save budget/blank name as null without selecting/completing a scenario.
- MFA enrollment P1 races: BEGIN/CONFIRM compare observed secret, enabled state and authenticated version; conditional writes cannot overwrite enabled secret or adopt a later revocation. authRoutes.test.ts includes six intervening-change negatives, parallel confirmation and commit/sign revocation; integration/cpoMfaEnrollment.itest.ts exercises PG winner/audit rollback/Finance audit separation.
- Upload/correction race, historical requirement collision, correction deadlines, incomplete closure projection and retired pinned policy: source repaired; integration/cpoScenarioCorrection.itest.ts and integration/cpoAuditDocuments.itest.ts hold explicit overlap/rollback/history regressions. Intake deadline remains unchanged, 80ms RTT gate retained.
- Legacy contract fingerprints: parent authorization is separate from original ISSUE/SIGN semantic fingerprints. integration/cpoAuditFinance.itest.ts:354 verifies old result fingerprints and exact replay without ledger/obligation/audit additions.
- Harness rejection ownership/security: protectedInput scope owns callbacks, observes original waiter promises without replacing their rejection, drains cleanup and masks secret/MFA pixels. cpoBrowserSecretPolicy.test.ts and legacyE2ESecretPolicy.test.ts cover actual-script subprocess failures and canaries. Browser regression runs after browser installation in the component gate, not pure unit initialization.
- Parties follow-ups: acknowledged DTO/current timestamp rendering, retained update command, definitive409 recovery, keyed disposal, valid PHONE fixtures, older GET versus newer SSR, cross-form pending-command isolation and discriminated state rendering all inspected on 944. caseParties.e2e.mjs counts mutation attempts synchronously before network scheduling. Generic transport regression is not substituted for R944-01/02.
- Validator five-step omission P2: fixed with exact workflow names for 80ms intake, CPO fixture setup/cleanup, auth-failure browser and component browser. Ten omission/failure cases added; all 27 required names matched workflow exactly in the prior independent check. Human signatures/release gates unchanged. Earlier independent focused validator test result was 2/2, skipped0; not rerun here.
- External restore-helper P2 checkpoint loss: fixed and separately cleared for exact 944 and helper SHA256 6dd0d43938bc33100fc37dee53c4fe7efd9e0655ecfadc94c0b7fa7c093a5f8a. Source/archive/target/owned-cleanup/resume-only guards reviewed; no helper executed by reviewer. Clearance does not extend to a new Production stage helper.

## Independent Executions In This Review

1. `node --import tsx --test tests/cpoAuditMoney.test.ts tests/cpoAuditDocuments.test.ts tests/cpoAuditBoundary.test.ts tests/caseDomain.test.ts tests/m3Domain.test.ts tests/cpoCommandNamespace.test.ts`: 57 tests passed, 0 failed, 0 skipped; exit0.
2. `node --import tsx --test tests/authCrypto.test.ts tests/authInfrastructure.test.ts tests/authRoutes.test.ts tests/cpo02FirstOrganizationAdmin.test.ts tests/cpoOrganizationPage.test.ts tests/cpoBrowserSecretPolicy.test.ts tests/legacyE2ESecretPolicy.test.ts tests/operationalTransaction.test.ts tests/commercialQuote.test.ts`: 87 passed, 0 failed, 0 skipped; exit0.
3. Total independent current focused executions: 144 passed, 0 failed, 0 skipped. These are focused domain/unit/synthetic-subprocess checks, not full CI or deployed UAT. No current PG/browser suite duplicated while main owned the gate.
4. Inspected supplied Parties repeat receipt `/var/folders/qb/b_w5j2x945v3cxsvk0rhrwyw0000gn/T/td-parties-repeat-hcSjjJ/receipt.json`: source944, TARGETED_PARTY_ASYNC_BROWSER, five exit0 runs, productionChanged=false. Receipt inspection is not an independently repeated browser journey or signed proof.

## Attributed Evidence, Not Independent PASS

- Main reports exact944 full unit exit0; full canonical PG gate still in progress at this review checkpoint. Earlier affected fulfilment suite reports 8 passed with schema cleanup. Do not convert this into a final full-gate result.
- Main reports synthetic Preview restore: all53 tables/counts/digests match under UTC, no-op/parity/local cleanup pass. Default Moscow versus Etc/UTC digest difference was canonicalized and both actual session TimeZone values asserted. Fixture archive source4ec remains distinct from runtime944; 12-path parity was independently checked earlier. No Production data restore was performed by reviewer.
- Main reports fresh Preview deployment oe0w9cgse / dpl_59ez... building. Reviewer did not fetch deployment/network state. Not READY/UAT PASS and not a full deployment-ID attestation.
- Exact-head source CI, final local full gate/build/browser, authenticated fresh Preview UAT and final evidence-head validation remain unverified/pending here.

## Historical Evidence And External Limits Preserved

- Existing c0567/PR34 smoke/CI/Preview and serving875 historical handoff are not relabelled as PR36/944. Earlier local unit/integration/build/E2E stops, optional-skip issue, trigger mismatch, first-admin navigation404, auth error masking and stale Parties result remain recorded in cpo-audit-repair-20261013.md and prior receipts.
- Original Production credential/provisioning refusal is not rerouted. No new CPO organization/accounts, policy activation, real MFA-secret extraction or Production access is authorized by this review.
- Production scanner is external/unconfigured: technical response503/fail-closed is not malware-provider validation. Synthetic scanner/PDF/browser success does not change this boundary. Real storage/provider/legal document rules, signing policy and Finance thresholds remain external human/operator decisions.
- Finance/Accounting, Legal/Privacy and Ritual SME human verdicts remain PENDING; no human attestations fabricated, resigned or transferred. Full rollout remains closed; only existing restricted CPO organization m3-cpo-audit-20260923 is the scope ceiling. NOX excluded, M4 not started.
- Fresh frozen875 rollback deployment, fresh encrypted Production backup/local real restore/rehearsal, exact two-migration Production operation, customer-baseline qualification, restricted synthetic smoke and approved rollback semantics require separately authorized operator gates. The new PR36 stage operator helper is not reviewed or cleared here; legacy release.mjs remains unusable for PR36.
- Additive document trigger migration intentionally makes old-runtime uploads fail closed. Rollback must retain freeze; do not describe old875 as fully functional after the schema repair, and do not destructively reverse history.
- Review is not exhaustive formal verification, a universal timing-side-channel proof, a real-scanner certification or proof that every unchanged dependency is safe. PG race/DDL execution was not repeated by reviewer during this pass. Two required server regressions and current evidence rebinding remain outstanding.

## Reviewer Actions

Read-only repository review and focused tests only. This external receipt is the sole authored artifact. No application source edits, credentials/Keychain/archive inspection, DB access, network/deployment calls, SSH, Production access or new operator-helper execution. No heavy full-tree content hashing, build or PG collision with main.
