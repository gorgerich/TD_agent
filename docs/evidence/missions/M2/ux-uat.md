# M2 UX and UAT contract

Required UAT journeys:

1. Cremation: Case -> Draft -> Review -> Publish v1 -> Request changes -> Draft
   v2 -> Publish v2 -> Accept -> audit/task outcome.
2. Relative burial: compatible package/add-ons/replacements -> Review -> Publish
   -> print/PDF -> Accept -> audit/task outcome.

Required states include loading, empty, validation, unknown-price blocker,
unknown-cost notice, retryable API failure, conflict, offline recovery,
permission denial, expired/revoked link and superseded version.

Desktop, mobile, keyboard and 200 percent zoom must keep the primary action
visible without horizontal overflow. Critical and serious accessibility findings
must equal zero.

## Authoritative status

Released Preview UAT passed on deployment `dpl_3axb1aDPUAEVevmE7ejaysV49UKc`
against isolated database fingerprint `c89bdda845806b40`. Production fingerprint
`0257665af2dd90a4` was excluded.

Post-release repair UAT was repeated on isolated local database fingerprint
`64c6dfded84be980`; production fingerprint `0257665af2dd90a4` was excluded:

- cremation: PASS;
- relative burial: PASS;
- builder/economics/client total equality: PASS;
- immutable v1/v2 history: PASS;
- draft/published isolation: PASS;
- client decision and print: PASS;
- Agent/Manager and cross-tenant contexts: PASS;
- mobile 390 x 844 and deterministic 200 percent zoom geometry at 195 x 422: PASS;
- canonical Quote read failure hides the total, exposes one retry action, blocks autosave and
  manual save, then recovers only after a 200 response: PASS;
- route change while draft save is in flight prevents the staged review/presentation mutation:
  5/5 full journeys PASS;
- failed post-publish canonical refresh removes stale total, publish/link handles and every
  write action until a successful read-only retry: 5/5 full journeys PASS;
- a late rejected request from the previous route cannot show a stale failure toast or clear
  the current Quote's pending state: 5/5 full journeys PASS;
- route authority expiring after response headers but before success or non-success JSON body
  completion cannot mutate state, show feedback or launch the staged action: 5/5 PASS;
- critical/serious accessibility findings: 0;
- browser skipped: 0.

Visual inspection covered desktop economics/history and mobile economics/history. The
mobile tab rail initially clipped its edge labels; the repair replaced scrolling
max-content tabs with four stable equal-width tracks. Measured tab bounds are 20..370 px
inside a 390 px viewport, and document scroll width equals viewport width.

At 195 px, each tab label remains inside its own track, document width equals viewport width,
the sheet save action is fully visible above the global dock, dock labels collapse while their
accessible names remain, and no live content is clipped or hidden behind motion.

No production browser write was performed. The repair still requires an exact-SHA Vercel
Preview and final CI before owner merge authorization.
