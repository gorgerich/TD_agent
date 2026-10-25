# Infrastructure Observation, October24

## Access And Scope

Normal Railway MCP whoami succeeded. TD project/service/metrics reads succeeded;
the historical OAuth and UnknownTool failures are no longer current blockers.
No variable values, connection strings, customer records, SSH or database contents
were read. No paid service, deployment, migration, freeze/plan change or NOX-specific
configuration/metrics operation was performed.

The workspace contains six projects. Only TD candidates and two ambiguous project
service inventories were checked; NOX projects and the unrelated Telegram app were
excluded from further inspection. Identifying a service in a shared project is
not permission to reuse it.

## Existing Placement Facts

| Project/service | Fresh observation | Placement decision |
| --- | --- | --- |
| ingenious-encouragement204385e0-1f5d-4711-ac49-74475d0d7093 | TD Postgres-4Mdx32492019-8037-4443-807b-3919626ccc63 plus excluded NOX services | No eligible separate TD application/scanner compute service. Never cohost in Postgres or NOX. |
| td-agent-m3-preview-20260824317daa1f-dd94-4c1e-84bb-929abd290d9f | Only Postgres857fe7b5-0392-4579-9c09-aa10d174b51d in environment6a4dc3cb-2eb0-4d33-bbcb-c024fad8dd5c | Separate Preview database, not spare application compute. |
| wholesome-courage526cfa4c-81eb-456a-ae11-ebe487c66c26 | td-agent-week2-restore-202607161157d8c0-a851-4989-adae-0838b5adf1e9 uses Railway Postgres18 image | Retained restore resource; do not delete, repurpose or count it as available scanner hosting. |
| giving-solace630b2b70-8b7e-45e8-9cea-24ba38f09268 | tihiydom-web54c7b990-016f-4b6f-a55f-08e00c34bc23 sourcegorgerich/frontend/main plus another Postgres | B2C application, not TD_agent; source identity checked only. No repurposing or modification. |

## Actual Resource Measurements

Railway168-hour/hourly samples,169 samples each, collected October24:

| TD service | RAM current/mean/max GB | CPU current/mean/max vCPU | Disk current/mean GB |
| --- | --- | --- | --- |
| Production Postgres-4Mdx | 0.061017224 /0.063570331 /0.068154751 | 0.000473087 /0.000412210 /0.000810244 | 0.224043008 /0.224018289 |
| Preview Postgres | 0.207851649 /0.168335921 /0.318115308 | 0.000365253 /0.000459387 /0.002310934 | 0.411443200 /0.355281036 |

Production service limits are8GB/8vCPU. They are not prepaid idle capacity or an
authorization to put application/scanner processes inside the database container.

## Bill Calculation And One Topology

The one placement proposal remains separate TD application, isolated authenticated
ClamAV gateway/daemon, bounded scheduled worker and private document storage in
the existing TD Railway project, with TD Postgres unchanged. No such eligible
prepaid compute host was found in the checked resources. No services were created
and migration has not started. Current traffic/application peaks and scanner
resident/reload/throughput behavior must be measured before final sizing.

Published container rates rechecked October24: RAM$10/GB-month, CPU$20/vCPU-month,
volume$0.15/GB-month, egress$0.05/GB. Source:
https://docs.railway.com/pricing/plans . Included usage counts once through the
subscription floor; it is not an extra free budget.

For the same Hobby billing period, the total-bill comparison is:

```text
delta = max(5, existingWorkspaceUsage + newTDUsage - retiredTDUsage)
      - max(5, existingWorkspaceUsage) + VercelAfter - VercelBefore
```

Only proven retired TD costs may be subtracted; no NOX/B2C or retained backup
offset. Vercel Hobby subscription has no20-dollar fee to reclaim by cancellation.
Actual storage and other charges must be included rather than assumed zero.

For scale, extending these seven-day mean measurements unchanged over a monthly
unit-price period gives approximately$0.677550256 for TD Production Postgres and
$1.745839104 for Preview Postgres, excluding egress. These are CONDITIONAL RUN-RATES,
not the actual invoice, remaining credit, an approved shutdown, or guaranteed savings.
ClamAV's documented minimum3GiB =3.221225472GB would cost$32.21225472 for memory alone
IF that amount were continuously consumed. A limit is not actual consumption; no
all-in minimum or complete scanner/app quote is claimed. Official guidance:
https://docs.clamav.net/manual/Installing/Docker.html .

Thus a zero-incremental-dollar, operationally validated arrangement has NOT been
established on the existing eligible resources. Creating new metered compute is
not authorized by this observation. The precise shortage is an eligible separate
TD compute host, not capacity inside Postgres. A global impossibility claim about
uninspected owner-owned infrastructure would be unsupported.

## Remaining Invoice Visibility Limitation

The currently exposed Railway connector has no billing/invoice/usage-cost method.
Normal browser access to Railway was attempted; its session was logged out.
Continue-with-GitHub led to the normal sign-in screen with no existing SSO session.
No account/password was entered or read and no OAuth query data is retained here.
Native browser inspection failed to start. An actual current bill/credit/plan has
therefore not been freshly retrieved. October20 workspace$6.556486571878272 remains
a historical workspace total, not a current or TD-only invoice.

For an exact final bill delta the owner needs only to complete the ordinary
Railway web login for its Usage/Billing UI; no new permission scope, paid action,
API key, repeated plugin OAuth or secret in chat is requested. The agent can then
read the current bill through that interface. This does not authorize creating
or repurposing a resource.

## Production And Capture

Fresh Vercel alias metadata: READY deploymentdpl_EUHyDbLQgdVP2fgWubxvZdsdWguW,
source91ae4fb23b8f87c0574ccec23708daeabdc50fc9. Team metadata returned identity but
did not expose billing fields; do not treat absent fields as a plan change.
Hobby/active was last actually verified October23. Current official Vercel Terms
section4 still restricts Hobby to personal/non-commercial use:
https://vercel.com/legal/terms . No commercial exception or upgrade established.

The existing scheduled-retention monitor was normally updated and configuration
reread on October24. Private durable local capture is configured for the next
window; actual scheduled success remains unproved. Current Production91 does
not expose the deletion count in its logs; preserve unknown rather than invent
the cleanup result. Full details: retention-capture-handoff.md.

Six focused collector regressions, typecheck and targeted ESLint passed. Final
independent collector/draft review found P0/P1/P2=0. No full suite rerun, native
Production backup, real scanner acceptance or release was performed here.
