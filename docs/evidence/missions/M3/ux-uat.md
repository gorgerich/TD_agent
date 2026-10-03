# M3 exact-SHA Preview UAT

## Environment

- Deployment: `dpl_Fo28yhKy4XrW4uvVwGGcZ9cE12y5`
- SHA: `ced3fad0fee5e5018bf4dab93cf87f644c0e4a3f`
- URL: `https://td-agent-qpgnu84mw-rics-projects-9baa2793.vercel.app`
- Database fingerprint: `545a187f9e9d66b0`
- Production fingerprint excluded: `0257665af2dd90a4`
- Private storage: `store_Ov8erHstuvfJ52Og`
- Data: retained isolated UAT run `preview-20261003-ced3fad`: 2 synthetic organizations,
  6 synthetic role identities, and 2 synthetic Cases.
- Vercel Deployment Protection remained enabled; authenticated automation bypass was used only
  for this protected Preview.

## Journeys

### Cremation

Case -> applicant/payer roles -> cremation requirements -> upload -> quarantine -> controlled
scan failure -> clean retry -> reviewer verification -> accepted QuoteVersion -> ContractVersion
-> 176,000 RUB obligation -> 88,000 RUB partial payment -> remaining 88,000 RUB -> webhook full
payment -> stage guard -> reconciliation.

Result: **PASS**.

### Burial in a family plot

Case -> applicant/decision-maker/payer/responsible roles -> distinct family-plot checklist ->
document rejection -> replacement upload -> verification -> signed ContractVersion -> payment ->
refund/correction/reversal -> separate approval -> stage guard -> reconciliation.

Result: **PASS**.

## Negative and reliability checks

- Upload is not verification: PASS.
- Unverified/rejected/expired requirement blocks the guarded stage: PASS.
- Reviewer and Finance purpose-limited projections: PASS.
- Cross-tenant access: denied.
- Webhook repeated five times: one entry, one original response, four replay responses.
- Lost response retry: same command envelope, one ledger entry, truthful replay result.
- Duplicate click and concurrent command handling: PASS.
- Storage/API failure is explicit and recoverable: PASS.
- Reconciliation: 0 discrepancies for both Cases.
- Unexpected 5xx: 0.
- Skipped: 0.

## Accessibility and mobile

- Axe critical findings: 0.
- Axe serious findings: 0.
- Keyboard and visible focus: PASS.
- Mobile 390x844: PASS.
- 200 percent equivalent viewport 195x422: PASS.
- Document root horizontal overflow: 0.
- Primary actions remain reachable; the fixed mobile navigation is offset by content padding and
  does not hide the final actionable row.
- Historical element capture at the 200 percent equivalent viewport showed owner
  and due-date metadata wrapping without clipping. It is not new-SHA image proof.

## UI quality and scope

The new source passed actual keyboard, mobile, 200 percent equivalent viewport,
overflow and axe checks in CI and protected Preview. The Finance repair adds no
decorative layout, fonts, gradients, animation or new icon system. It keeps the
existing functional dialog and makes errors single-location and recovery explicit.
This is not a claim of perfect compliance with every aesthetic point of AGENTS
across the entire legacy platform. Older screenshots are not new-SHA captures.
The new recovery dialog was exercised on desktop; responsive workspace checks
must not be described as an exhaustive mobile test of every modal state.

## Screenshots

- `screenshots/case-documents-desktop.png`
- `screenshots/case-documents-mobile.png`
- `screenshots/case-documents-zoom200.png`
- `screenshots/finance-desktop.png`
- `screenshots/finance-mobile.png`
- `screenshots/finance-mobile-dock.png`
- `screenshots/reviewer-desktop.png`
- `screenshots/reviewer-mobile.png`

These captures are historical artifacts from Preview runtime
`784140db230e8d0c1a566d2e70bbce91162a5587`, not screenshots of the current
deployment. The current exact-SHA UAT above was exercised in headless Chromium;
it did not produce replacement image files. Do not use these images as proof of
the current SHA.
