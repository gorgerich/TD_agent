# Railway Reconnection Follow-up

Historical failure below was resolved October24: normal MCP whoami and exact
TD resource reads now succeed. Do NOT request Railway OAuth again on the basis
of this historical failure. Current observations are in infrastructure-20261024.md.
The existing cron monitor update also succeeded on October24; see retention-capture-handoff.md.

Owner reports normal Railway OAuth reconnection completed. The current session
cannot verify it: railway_whoami and railway_list_services now return MCP-32001
Unknown tool (`railway.whoami`, `railway.list-services`), NOT the previous401.
The installed Railway plugin remains ENABLED in plugin discovery. A later retry
after independent local work returned the same unknown-tool error. The ordinary
CLI principal is not logged in. No token extraction, SSH, database access or
Production credential/provisioning fallback was attempted.

This is a host integration/catalog failure; do not represent it as proof that
the owner failed OAuth or ask them to repeat that same authorization. The app
automation service is also unavailable. Restore/reload the existing Codex session's
integration catalog, keeping this worktree and task, then verify normal Railway
whoami and exact TD-only service/billing reads. Fresh invoices, prepaid capacity
and a complete costed zero-incremental-dollar host plan remain unverified.

## One Topology, Not Provisioning Authorization

Evaluate a TD-only application service, separate authenticated isolated ClamAV
gateway/daemon, bounded scheduled worker and private document storage in the
existing Railway TD project204385e0-1f5d-4711-ac49-74475d0d7093. Keep existing TD
Postgres32492019-8037-4443-807b-3919626ccc63 as database only; exclude NOX entirely.
This is a placement candidate, not proof those suitable services are already
paid for or that new usage is free. Do not create it or move the application yet.
The initial queue/admission/concurrency policy must follow actual workload tests;
no traffic forecast or spare capacity is invented from Postgres's low utilization.

## Final-bill Delta, Not Credit-as-Budget

For the same Railway Hobby billing period, let U be existing aggregate metered
workspace usage, A/S/J/D the additional app/scanner/job/storage usage costs and R
the proven cost of retired TD-only resources. Do not retire NOX, backups or
unknown resources. Let Vbefore/Vafter be actual total Vercel costs before/after
the reviewed move, including any retained storage. The comparison is:

```text
delta = max(5, U + A + S + J + D - R) - max(5, U) + Vafter - Vbefore
```

Included credit is counted once through the subscription floor, never as a new
free budget. If U exceeds5 and nothing billed is retired, each extra metered
dollar increases the bill. Existing Vercel Hobby has a zero subscription fee;
removing it does not create a20-dollar saving. Actual storage/other charges and
credits still require the fresh account read. Historical October20 U6.556486571878272
was a workspace total, not a TD-only invoice or a current measurement.

Published Railway container usage prices and the conditional scanner RAM
calculation are in infrastructure-zero-budget-20261023.md. They are not an
all-in measured invoice or a proven minimum. Vercel Hobby's commercial-use
restriction is contractual, not an application defect. A zero-incremental-cost,
commercially permitted placement on the owner's existing paid resources has
NOT been established. No new paid service, tariff change, customer-document
processor, deployment or migration has been enabled.

PR39 remains OPEN/DRAFT at8a7115e1ffe9d06dd14c47d3e52595bd3de7ef78.
New capture tooling and decision drafts are local changes, not the previously
green exact-head CI or native48 UAT. Preserve that distinction until a reviewed
successor is committed and validated.
