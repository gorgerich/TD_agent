# M3 exact-SHA Preview UAT

## Environment

- Deployment: `dpl_Dzj7KprKCNASbVN1xPBpfPoraD8f`
- SHA: `a917a1f10b959b80cd4e0a249a2d2281e0bba106`
- URL: `https://td-agent-1plelby0t-rics-projects-9baa2793.vercel.app`
- Database fingerprint: `646addef2eb61519`
- Production fingerprint excluded: `0257665af2dd90a4`
- Private storage: `store_Ov8erHstuvfJ52Og`
- Data: 2 synthetic organizations, 6 synthetic role identities, 2 synthetic Cases.
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

## Anti-slop and UI quality re-check

The entire applicable AGENTS anti-slop law was re-checked after the exact-SHA capture:

| Area | Result |
| --- | --- |
| Product composition | Operational workspaces remain dense, task-focused tools; no landing hero, fake app mockup, decorative dashboard, pricing/testimonial/CTA template, or nested card theatre was introduced. |
| Color and material | Existing TD Agent palette is retained; no purple gradient, glow orb, candy aurora, glass imitation, background grid, hard color seam, or broad halo shadow was added. |
| Typography | Existing product typography and letter spacing are retained; no new Google display font, gradient headline, cramped negative tracking, decorative quote, mono house voice, or repeated kicker template was added. |
| Containers | Cards frame real repeated records or tools only; radius stays restrained, shadows are directional/subtle, gutters are consistent, and no content sits against a viewport edge. |
| Icons and controls | Existing icon system is used for real commands/status; no hand-drawn substitute, icon tile hero, dead tab, fake toggle, default theme switch, hover lift, or animated underline was added. |
| Motion and visibility | Content is visible by default; no opacity-zero entrance dependency, floating card loop, parallax decoration, or animation-gated control exists. |
| Alignment and clipping | Desktop, mobile, and 200 percent layouts have no document-level horizontal overflow; headings, values, buttons, tables/cards, empty states, and nav marks remain inside their functional regions. |
| Responsive behavior | Finance rows become stacked records on mobile, Reviewer preserves a clear empty/queue state, Case actions remain above the bottom dock, and long synthetic references wrap without widening the page. |
| Interaction truth | Every rendered control used in UAT was clicked through a real route/API; errors never present empty success, and retry replays the stored command rather than a reconstructed mutation. |
| Accessibility | Semantic buttons, labels, focus, touch targets, keyboard flow, mobile, zoom, and axe critical/serious gates pass. |

## Screenshots

- `screenshots/case-documents-desktop.png`
- `screenshots/case-documents-mobile.png`
- `screenshots/case-documents-zoom200.png`
- `screenshots/finance-desktop.png`
- `screenshots/finance-mobile.png`
- `screenshots/reviewer-desktop.png`
- `screenshots/reviewer-mobile.png`

These captures were generated from the exact deployment above after its complete synthetic UAT.
