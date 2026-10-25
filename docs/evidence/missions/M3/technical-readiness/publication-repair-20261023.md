# Publication Deadline Repair, 2026-10-23

## Historical Native Failure

Source `22901f331667e3ac54a60b0a2c8f21d3a7a101f9`, private Preview deployment `dpl_DoLTa7GwaGCGApH5wm9bZaNkMdGa`, stopped during authenticated fixture preparation: draft/review HTTP200, publication HTTP500. Run `accdfca47416f7357b2517f0` never reached the three browser UAT programs. The runtime diagnostic was only `INTERNAL_ERROR`; it did not identify a Prisma code. Do not retroactively label that exception P2028 or this run PASS. Its approved Preview DB fingerprint was `545a187f9e9d66b0`, distinct from Production `0257665af2dd90a4`. All six owned active-access counts were zero after containment, and the credential copy was deleted. Synthetic history remains retained.

Source CI [39839883471](https://github.com/gorgerich/TD_agent/actions/runs/39839883471) passed its technical steps but failed authoritative evidence validation. It is not overall CI PASS and does not certify the successor repair.

## Actual Local Reproduction

An isolated PostgreSQL API-level fixture with materialized scenario requirements, scheduled meeting, open quote-send task, real draft/review and authenticated publication reproduced HTTP500 for both scenarios with80ms injected network RTT. Observed transaction durations were5040ms and5123ms; the instrumented transaction reported PrismaP2028. Observed route SQL statements were38 and40. Lock waits were not separately measured. This establishes a local deadline failure, not the exact historical native exception or a measured Production network latency.

The generic publication transition loaded document versions, contract versions, obligations/ledger and policy parity although its evaluator consumes only quote-version membership. The repair reuses the tenant/owner Case already locked by this command and obtains version IDs through the original `quote.meeting.leadId` relation in one query. It does not impose a different legacy `Quote.caseId` rule, trust a submitted version ID, change other transitions, increase the5000ms deadline, or move any required write outside the transaction. Case/event, task completion/audit, projection receipt and final quote audit remain atomic.

## Actual Successor Checks

- [Five latency repeats](publication-latency-20261023.json):5/5,10/10 tests, failed0/skipped0; every original publication HTTP200, maximum transaction4444ms against the unchanged4500ms headroom threshold. Observed route SQL31-32; diagnostics include route authentication, not only transaction statements.
- Each scenario injects a failure at the final commercial audit after the preceding domain/projection writes, verifies complete rollback, then retries the same command successfully. Case stage/pointer, exactly one version/event/completed task/receipt/publish audit, truthful replay and changed-payload409 are asserted.
- [Five idempotency/concurrency repeats](publication-concurrency-20261023.json):5/5,15/15 tests, failed0/skipped0, exact replay/result identity and parallel duplicates without repeated side effects. All owned schemas removed.
- Existing commercial/case PostgreSQL subset:18/18 PASS, skipped0, including immutable version history, acceptance, tenant/link boundaries and full Case chain/reconciliation. The later expanded Case file passed10/10, skipped0, adding direct sibling-version422, teammate/cross-tenant404, legacy meeting-linked publication and republish/replay guards. Its initial new fixture omitted a required meeting idempotency key; that fixture error was repaired, not waived.
- Independent read-only reviewer found no P0/P1/P2 in the final loader/test/workflow delta and independently executed27 domain/commercial unit tests, skipped0. This is not a claimed independent native UAT execution.
- Affected lint, final typecheck and production build passed; runtime dependency boundary inspected118 traced manifests and found0 forbidden tooling-package matches. Full successor unit/canonical PostgreSQL checks were still running when this source record was prepared; their final results must be recorded separately, not inferred from predecessor runs.

Fresh exact-source native Preview UAT, final authoritative packet reconciliation and overall exact-head CI remain required. No new Production backup, customer digest, scanner-provider acceptance or actual scheduled-cron proof is claimed by these local results.

## Production Boundary

Fresh read-only deployment metadata on October23 still reports `dpl_EUHyDbLQgdVP2fgWubxvZdsdWguW`, READY Production, source `91ae4fb23b8f87c0574ccec23708daeabdc50fc9`. PR39 remains OPEN/DRAFT/MERGEABLE with required review. No merge, Production mutation/configuration/deployment, freeze change or NOX action was performed. Professional verdicts remain PENDING; real-agent rollout remains closed.
