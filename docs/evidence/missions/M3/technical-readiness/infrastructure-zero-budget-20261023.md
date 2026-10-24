# Zero-incremental-budget investigation, October23 19:13UTC

Scope: PR39, TD Agent only. No deployment, migration, environment/freeze change,
credential fallback, Railway SSH, paid resource creation, or NOX operation.
Existing code, exact48 UAT and exact8a green CI are preserved. No full suite rerun.

## Normal Railway reconnection

The existing installed Railway plugin is ENABLED but `railway_whoami` returned
`UNAUTHORIZED`: `This app connection requires reauthentication. Reconnect the app and try again.`
The plugin manager confirms installed plugin `plugin_asdk_app_6a502589384081919c5decf93496c9d1`.
No available management tool performs OAuth reconnection. Opening the ordinary
plugin page through browser/panel tools failed; no OAuth completion is claimed.

Owner action: open the existing [Railway plugin card](https://chatgpt.com/plugins/plugin_asdk_app_6a502589384081919c5decf93496c9d1),
select its account Connect/reconnection action and finish Railway OAuth.
Alternatively, Settings > Plugins > Railway opens that account setup surface.
These are documented setup instructions, not a claim that the current button
was personally observed or clicked. No uninstall/reinstall or pasted token is requested.
[Railway Codex setup](https://docs.railway.com/ai/codex-plugin) links this exact card;
[account setup instructions](https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt)
describe Settings > Plugins and Connect.

Fresh Railway billing, eligible existing TD compute services and available prepaid
capacity remain unverified. October20 measurements in real-production-scope-20261020.md
are dated observations, not current availability. Workspace usage $6.556486571878272
already exceeded the included $5; it was NOT a TD-only bill. Postgres's low CPU/RAM
does not authorize cohosting or prove free capacity. Do not inspect or reuse NOX.

## Commercial hosting and one topology to evaluate

Authenticated Vercel team metadata still reports Hobby/active. Official
[Terms section4](https://vercel.com/legal/terms) allows personal or non-commercial use only.
This is a provider-plan restriction, not proof that login, cron or Next.js is broken.
No exception is established. Published [Pro pricing](https://vercel.com/pricing)
starts at $20/month before applicable extras; no upgrade is authorized or performed.

One topology for evaluation, NOT an approved zero-cost deployment plan:

| Component | Proposed placement | Capacity and unresolved input |
| --- | --- | --- |
| Next.js application | Separate TD-only Railway application service in project204385e0-1f5d-4711-ac49-74475d0d7093 | Actual application steady/peak RAM, CPU, concurrency and request traffic must be measured; no forecast is invented. |
| Private documents | TD-only private storage behind the authorized storage adapter, separate from Postgres and NOX | Existing eligible paid storage capacity and commercial terms must be established; changing the current Blob adapter/storage requires a reviewed migration/access/retention plan. |
| Malware scanner | Separate isolated TD-only ClamAV daemon and authenticated bounded gateway, no database credentials or public clamd port | Official Docker guidance minimum3GiB/preferred4GiB, plus measured admission/reload tests. Local two-file cold process is not this service. |
| Scheduler | Railway scheduled bounded worker, calling only the authorized TD maintenance operation | Idempotency/concurrency and execution proof required; CPU/RAM/egress usage is still metered. |
| Database | Existing TD Postgres32492019-8037-4443-807b-3919626ccc63 unchanged | Not a host for the app/scanner/worker. |

This avoids Vercel Hobby as commercial application hosting, but requires finding
eligible already-paid TD compute/storage capacity. None is currently established.
Do not create a new paid service or start a move on this basis. Actual demand is
unknown; a proposed admission limit is not an observed load forecast.

[Railway container prices](https://docs.railway.com/pricing/plans): RAM$10/GB-month,
CPU$20/vCPU-month, volume$0.15/GB-month, egress$0.05/GB.
For transparency, 3GiB =3.221225472GB, so continuously holding that much memory
alone corresponds to $32.21225472 using the published monthly RAM unit price.
This is a conditional capacity-budget calculation, NOT measured resident use,
not an invoice quote, and not a proven global minimum. CPU, application, storage,
definition updates, egress, peak reload and taxes are not included. Local measured
peak1,298,788,352bytes is neither steady memory nor a Production resource guarantee.
[ClamAV memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).
No legitimate exact all-in minimum or zero-dollar guarantee can be derived until
normal Railway access supplies current eligible resources, credits and usage.
The historical $55 proposal remains rejected, not silently approved or resubmitted.

## Cron diagnosis, not execution certification

Fresh authenticated project metadata:

- projectprj_1lA8bU4JS13sSJYKH22oCWuWkB5g, teamteam_2bCVT1emiAQS4WOT01ndaA7b;
- enabledAt1779634384656, disabledAtnull, updatedAt1792316187304;
- deploymentdpl_EUHyDbLQgdVP2fgWubxvZdsdWguW READY,
  source91ae4fb23b8f87c0574ccec23708daeabdc50fc9, regioniad1;
- path/api/internal/rate-limit-retention, schedule17 3 * * *, UTC;
- scheduler definition hosttd-agent-mridhtsti-rics-projects-9baa2793.vercel.app;
- Production CRON_SECRET metadata exists, typesensitive, created/updated1791035955458,
  before serving deployment creation1792316095532. Decryption was false; no value printed.

An initial `vercel env ls production` read failed without returning metadata.
The standard project environment metadata API with decrypt=false supplied the
presence/target/type/timestamps above. This is not proof of secret length,
runtime injection, matching Authorization delivery or successful dispatch.

Serving route is dynamic/no-store; proxy source does not redirect this path.
Its actual guards return401 for invalid/missing/short secret,503 for freeze or
retention failure,200 for successful drain. No manual request was made to test them.
Current freeze state and today's scheduled HTTP result are NOT established here.

Why previous observation was insufficient: console-only output is not the HTTP
request stream, default branch filtering can hide Production, and Hobby retention
is one hour. At19:13UTC the03:00-03:59UTC invocation window has expired. The provider
permits any minute in the configured hour;03:17 is not an exact-minute promise.
Neither an empty console query nor configured auth proves scheduled success/failure.

Official [log search documentation](https://vercel.com/docs/logs/runtime) distinguishes
requestPath/message free text from sidebar requestType filters. CLI help offers no
dedicated request-type flag; do not assume arbitrary requestType:cron free text was
honored. Require actual provider Cron filter/details and request ID/status/deployment
in fresh Request Logs. The existing monitor already requires verified provenance;
do not call the cleanup endpoint manually or treat user-agent/health rows as dispatch.
[Cron docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) also state no automatic
retry after failure. Underlying dispatch outcome remains UNPROVED, not PASS or a
diagnosed scheduler outage. No new paid observability is enabled.

Human Finance/Legal/Ritual questions remain in human-decisions.md and the three role
packets; genuine verdicts and reviewer credential registrations are still pending.
