# Retention Scheduled Observation: October25

Status: UNPROVED. No scheduled execution PASS is established by this record. No cleanup endpoint was called manually, and no Production configuration, database, freeze, deployment or paid observability setting was changed.

## Observed Facts

- Expected provider schedule remains daily03:17UTC, Hobby hourly precision; observation window03:00-04:35UTC. Project `prj_1lA8bU4JS13sSJYKH22oCWuWkB5g`, team `team_2bCVT1emiAQS4WOT01ndaA7b`, path `/api/internal/rate-limit-retention`.
- The supplied heartbeat arrived at08:21:40.760UTC, outside its permitted capture window. It cannot establish what the provider did during the earlier window or why local automation did not capture it.
- At the later resumed inspection, the private `cron-observations` directory did not exist. No receipt was available. This does not prove absent scheduled dispatch or a sleeping Mac.
- Read-only historical request-log queries for the elapsed window returned HTTP400, including a59-minute interval. The backend reason was not exposed. A fresh59-minute exact-path control succeeded with zero records. Neither result proves success or failure of the earlier scheduled invocation.
- Normal team metadata still reported Hobby. [Official runtime log retention](https://vercel.com/docs/logs/runtime) is one hour for Hobby; at inspection the scheduled window was already older. No paid upgrade was enabled. Console-only empty results are not treated as absent HTTP requests.

## Next Supported Capture

Keep the Mac awake, network connected and Codex open on October26 from06:00 through07:35Moscow (03:00-04:35UTC). The existing thread monitor remains active. The bounded read-only collector `scripts/ops/collect-retention-observation.mjs` saves sanitized private local receipts beyond provider retention. It does not trigger cleanup.

Actual provider Request Type=Cron classification must be inspected in fresh Request Logs/details if CLI output omits it. Correlate timestamp, request ID, deployment ID/exact SHA and status. Capture fixed cleanup diagnostics when actually exposed; otherwise mark outcome/deleted NOT_EXPOSED, never infer them from HTTP200. User agent, a health row, schedule configuration or a manual call does not substitute for provenance.

Local observation requires a running observer; this record does not promise durable unattended capture while the Mac or Codex is unavailable. No persistent OS scheduler or paid resource was created to bypass that limit. Serving-runtime diagnostics may be less complete than candidate87 diagnostics; missing fields remain unknown.
