# Historical M3 Preview UAT, 2026-10-03

This completed run is superseded by the Finance recovery repair. It is not a
verdict for a later source SHA.

- Source: `18e130990264813bde61ce7bc3b55aecec4d7d6c`.
- Deployment: `dpl_B2brhJerHwNjayzdChS4besUV7cV`.
- URL: `https://td-agent-oa5r4x24k-rics-projects-9baa2793.vercel.app`.
- Railway Preview fingerprint: `545a187f9e9d66b0`; Production fingerprint:
  `0257665af2dd90a4`. Exact Preview project/service binding was checked through
  captured Railway metadata and the deployed read-only identity endpoint.
- Dedicated synthetic schema: `m3_uat_20261003_18e1309`.
- Namespace: `preview-20261003-18e1309`; two organizations, six role users,
  two Cases. Unknown older Preview records were not deleted or modified.
- Both cremation and relative-burial scenarios passed authenticated browser UAT.
- Quarantine, review/rejection/replacement, immutable contract obligation,
  partial/full payment, refund/reversal, four-eyes, role visibility and guards:
  PASS.
- Webhook replay: one original response, four replays, one ledger entry.
- Lost payment response: exact serialized command replayed; one ledger entry.
- Cross-tenant checks, keyboard, mobile, 200% equivalent viewport and
  accessibility checks passed; critical/serious findings 0.
- Reconciliation 0; unexpected 5xx 0; skipped 0.
- Source CI `37114040155` passed technical steps and failed only at stale
  authoritative evidence. This is not an overall green CI claim.

Independent review subsequently found the dialog-close recovery gap. This old
run does not cover that repair. Human verdicts remain pending. Production was
not changed by this UAT.
