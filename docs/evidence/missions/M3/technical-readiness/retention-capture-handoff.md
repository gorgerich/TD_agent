# Durable Scheduled Retention Observation

Status: IMPLEMENTED_AND_LOCALLY_TESTED; EXISTING_MONITOR_UPDATE_CONFIRMED_20261024.
Actual scheduled dispatch and cleanup-result capture remain UNPROVED.
The existing monitor is not replaced with another scheduler. No manual cleanup
request, Production write, secret read or paid logging service is used.

## Capture

During03:00-04:35UTC, in this worktree, the existing monitor should execute:

```sh
env PATH=/Users/silkwayrally/.nvm/versions/node/v24.12.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin node scripts/ops/collect-retention-observation.mjs
```

The collector reads the existing authenticated Vercel CLI request-log view with
Production scope, exact TD project/path, no automatic branch filter,59-minute
lookback,100-record/4MiB/45-second bounds. It does not call the cleanup endpoint.
Outside the observation window it exits without invoking Vercel or saving a receipt.

Sanitized receipts persist under:

`~/Library/Application Support/TD Agent M3 Operator/cron-observations/`

Directory mode0700; unique exclusive files0600. An unsuccessful read also saves
a fixed failure receipt, never raw CLI stderr/stdout. Existing receipts are not
overwritten. Fields are observation/request time, deployment ID, provider request
ID, numeric HTTP status, actually supplied provider cron classification and a
strict fixed cleanup outcome/deletion count when exposed. No headers, arbitrary
messages, contact details or credentials are copied. Resolve deployment SHA from
the actual captured deployment's read-only metadata when certifying evidence,
not from whatever alias is currently serving after a later deployment.

If the CLI does not expose provider cron classification, use the actual Request
Logs Cron filter/details to correlate the same request. No UA/health-row inference.
Only confirmed sanitized facts belong in authoritative evidence; a saved pending
receipt is not a scheduled PASS. Retain actual scheduled failures for diagnosis.

## Current Serving Runtime Limitation

Production91's handler returns the cleanup response to Vercel but does not log its
deletion count. Candidate48 emits RATE_LIMIT_RETENTION_COMPLETED with fixed
outcome/deleted fields. Missing diagnostics are saved as
NOT_EXPOSED_IN_OBSERVED_LOG, deletednull; HTTP200 never supplies an invented count
or proves that no backlog remains. Provider request metadata and actual cleanup
detail are separate claims. Publishing the candidate is not authorized merely
to fill this diagnostic gap while its release conditions remain unmet.

## Activation History And Recovery

The normal automation API update of existing automation
verify-m3-scheduled-retention-execution was attempted, preserving its schedule,
name, active state and thread. The app returned:

`The app could not load this tool. Please try again.`

The native alias also reports that this app tool is no longer available through
dynamic tools and requests the unavailable Codex app MCP server. No raw automation
TOML edit, substitute cron automation or OS scheduler was used.

On October24 the normal API recovered. It successfully updated the existing
automation, returned ACTIVE, and the saved configuration was reread to confirm
the collector command and unchanged daily06:00/06:30/07:00/07:30 Moscow schedule.
The next configured window is October25,06:00-07:35 Moscow (03:00-04:35UTC).
No claim is made that the capture has already executed or that the host will
always run the heartbeat within provider retention. CLI whoami was also checked
through a sanitized wrapper: authenticatedtrue, no credential printed. A previous
team API read failed without useful output; that is not a diagnosed cron failure.

## Checks

- Six targeted tests PASS, fail/skip/cancel0: UTC window, non-fabrication of
  scheduler/cleanup proof, bounded fixed diagnostics, malformed records and actual
  temporary filesystem receipt permissions/failure persistence/time filtering,
  nested CLI completion messages and conflicting-result rejection. Independent
  review found the missing nested-log path; it was fixed, not deferred.
- Typecheck and targeted ESLint PASS after fixing a test-helper overload annotation.
- Independent focused review of the final collector, six tests, installed CLI
  mapping and professional draft found P0/P1/P2=0. It was not a full platform review
  or a live scheduled execution test.
- Outside-window execution returned OUTSIDE_OBSERVATION_WINDOW, no provider request.
- Full suites, Production cleanup and a scheduled capture were not run or claimed.

## Historical Metrics Access, October24

A separate read-only attempt queried only Production request counts for this exact
path during03:00-04:05UTC, grouped by deployment/status/path type. The supported CLI
returned `payment_required`: `Observability Plus is required to run this query`.
No upgrade was performed. The available count schema also lacks request ID and
provider cron classification, so a paid aggregate would not itself supply the
missing scheduled-execution/cleanup receipt. This is an observability entitlement
limit, not evidence that the scheduler did or did not execute. The next fresh
request-log collection remains the supported zero-additional-spend observation.
