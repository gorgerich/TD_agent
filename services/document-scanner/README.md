# TD Document Scanner: Prepared, Not Deployed

This service is an authenticated gateway to real ClamAV, not a synthetic scanner.
It has been built and partially accepted in a disposable local Linux container.
See docs/evidence/missions/M3/technical-readiness/scanner-local-acceptance-20261024.md
for actual engine phases and the explicitly failing maximum-file/load probes.
The follow-up scanner-profile-20261025.md reproduces reload/CPU contention and
records the serial-reload fix, actual2GiB/1CPU scan/reload measurements and limits.
No paid resource or Production configuration has been created. Actual hosted
acceptance remains a release condition, not a claim supplied by these local tests.

## Placement

One dedicated TD-only Railway service, separate from Postgres/NOX, after budget and
document-processing approval. Keep the application and its existing private Blob
on commercially permitted Vercel Pro; do not move the application under this plan.
No raw clamd TCP port is configured: only a mode0600 Unix socket inside the service.
Expose the HTTP gateway through Railway TLS; the application accepts HTTPS origins
only, refuses redirects and never sends storage keys, filenames or case/contact data.

Build from repository root on an approved Linux runner:

```sh
docker build -f services/document-scanner/Dockerfile -t td-document-scanner:reviewed .
```

Resolve and retain the actual built image digest, base-image digest and Debian
ClamAV package version before release. Mutable tags or the presence of this
Dockerfile are not build, vulnerability or runtime evidence. The disposable Linux
container build used local Lima/containerd; the official macOS package contains clamscan but not
clamd/clamdscan. A normal Homebrew attempt failed because this host has no supported
bottle; no source-toolchain upgrade or persistent local service was started.

## Configuration And Bounds

Gateway: `SCANNER_AUTH_TOKEN` from the protected operator mechanism, random at least
32bytes encoded as a token, never a repository/default value. App:
`M3_DOCUMENT_SCANNER=clamav-http-v1`, `M3_SCANNER_ORIGIN` exact approved HTTPS origin
without credentials/path/query/fragment, and matching `M3_SCANNER_AUTH_TOKEN`.
Do not set any of these Production values before the real provider is accepted.
An organization still needs genuine approved M3 policy bindings; configuring a
scanner never activates real organizations or substitutes for professional review.

Proposed one replica, no autoscaling; the successor's smallest locally tested
contour is2GiB/1vCPU with a1GB definitions-volume allowance. The earlier4GiB/0.5vCPU
envelope is not measured consumption or accepted sizing. Actual hosted
usage/reload/disk/CPU/throughput acceptance remains required.
FreshClam initially verifies/downloads definitions before gateway startup, then
checks hourly. clamd/refresh/gateway are supervised; one child exit terminates the
service. The root entrypoint only prepares owned runtime/definitions directories;
all three processes then run as `clamav`. Do not mount customer documents or DB
credentials. Restrict egress to the signature/update and platform needs in the
approved infrastructure; no arbitrary caller URL is fetched.

Serial database reload intentionally blocks new scans/readiness during update,
instead of competing with a second engine. The local measured update pause was
49.6seconds; return the existing retryable scanner-unavailable error and recover,
never widen deadlines, disable TestDatabases or invalidate verified predecessors.
2GiB/1CPU is the smallest locally tested contour, not a hosted capacity guarantee.

The gateway admits one authenticated active operation, rejects extra work429 rather
than queuing, caps connections32 and content10MiB, verifies declared length and
SHA256, bounds body/header deadlines and scan subprocess10seconds. The HTTP client
has a12second total abort deadline and2KiB response cap. Limits are not throughput
proof or a hard cloud-spend cap. Signatures older than48hours, future-dated,
unrecognized or unavailable daemon metadata fail readiness. The48hour operational
policy is a proposed conservative default, not a legal requirement or guarantee
that upstream always publishes within it; it needs acceptance/update recovery tests.

`/live` exposes only process liveness and is suitable for platform health checks.
`/health` and `/scan` require the bearer secret. `/health` verifies the actual daemon
version/signature time. No request body, filename, raw detector output or token is
logged. Application scan provider/result are audited through the existing document
version path; preserve provider engine/signature metadata in acceptance receipts.
HTTP availability does not certify actual engine freshness or scanner protection.

PDF/JPEG/PNG have basic structural checks before the engine; they are not complete
format parsers or malware protection. `application/octet-stream` supports authenticated
engine acceptance (including EICAR), not a new public business-upload MIME. Business
types and trusted review remain controlled by the document policy/service. HEIC/WebP
must not be enabled in real policy until separately accepted end-to-end. A zero exit
from clamdscan maps CLEAN; detection/limit alerts never do; unknown/error/timeout is
ERROR. CLEAN only opens review and never automatically sets VERIFIED.

## Required Actual Acceptance

Run against a disposable TD-only instance of the exact reviewed image, never by
stopping a serving scanner or sending real client data. Save engine/signature/image
versions, bounded timings/resources and the following actual outcomes:

1. Fresh authenticated health and a valid synthetic PDF/PNG clean result, exact digest.
2. Official EICAR string as octet-stream gives INFECTED, not a preview substring rule.
3. Truncated/wrong-magic PDF and unsupported MIME are rejected before engine admission.
4. Wrong/missing bearer gets401 without engine/file processing; oversized data rejected.
5. Stop only the disposable daemon: health/scan fail closed; no CLEAN/VERIFIED.
6. Pause only that daemon long enough to hit readiness deadline: bounded503/ERROR.
   Separately exercise a scan-child deadline and verify the child is terminated.
7. Restart the disposable daemon; fresh health and explicit retry recover safely.
8. Exercise real definition refresh/reload, stale/future metadata rejection, volume
   capacity and expected concurrent load. Check RAM/CPU/reload peaks before sizing.
9. Through the app, exercise quarantine/review/replacement/expiry/rescan/access audit;
   a still-valid VERIFIED version survives failed replacement and role/tenant negatives.

The targeted HTTP/protocol tests simulate engine outcomes and do not count as these
actual ClamAV/container observations. Source includes no test-mode endpoint or flag
that can force CLEAN. Use the proposed operational monitor with authenticated health,
signature freshness, restart count, resource/queue/timeouts and last successful scan;
no new paid monitoring service is authorized. Recovery means restore actual trusted
daemon/definitions and retry, never disable scanning or manually set VERIFIED.

## Rollback

Retain the previous signed image/configuration and definitions custody. If scanner
acceptance or smoke fails, keep uploads fail-closed and retain quarantined history;
revert only service/runtime configuration through the reviewed operator flow. Do not
delete document versions, alter keys, silently return CLEAN or reuse NOX/Postgres.
