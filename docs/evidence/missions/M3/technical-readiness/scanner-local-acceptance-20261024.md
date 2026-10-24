# Scanner Foundation: Actual Local Linux Observations

Status: LOCAL_ACCEPTANCE_PARTIAL_NOT_HOSTED_PRODUCTION_READINESS.
No paid hosting, Production configuration, database/document mutation or real
customer upload was performed. Runtime guards remain closed. The HTTP mock-engine
tests and old Preview UAT are not these actual engine observations.

## Exact Build

- Disposable local Lima2.2.1 VZ Ubuntu22.04 VM, Linux5.15.0-194-generic,
  3GiB RAM/2CPU; only the scanner build context mounted read-only. No home,
  credential, database or customer-document mount. Not a Railway SSH connection.
- Actual `nerdctl build` completed with Debian packages including clamdscan1.4.6.
- Base node24-bookworm-slim digest:
  `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`.
- Result manifest:
  `sha256:3ab7dacbe1c02bd5dc5228b41f6c5bd075f69d38de7c2a8a2a7740bded2a0bc6`.
- server.mjs SHA256:
  `581a56ffcdea12bc03825779ff2e96fc834ba1eef9edb10e2fff5eedda8019e2`;
  protocol.mjs SHA256:
  `87ac3c5ba7f15af4bd0a21bab624fc7be7c277c6fc665e49c7542bd9c7535673`.
  Host/build-context copies matched. Mutable image tags alone are not identity.
- clamd, freshclam, Node gateway and shell ran as clamav; tini remained root.
  No TCP clamd listener; only the owned private Unix socket.

## Actual Engine Results

First startup probe at11:03:29UTC was FAIL with503 while definitions loaded;
unauthorized remained401. It is retained, not relabeled PASS.

At11:03:53UTC, ClamAV1.4.6, daily signature28163 dated
2026-10-24T06:26:10.000Z:

| Check | Actual result |
| --- | --- |
| Fresh authenticated engine health | 200, validated engine/signature metadata |
| Synthetic blank PDF | CLEAN, checksum matched,64ms |
| Official EICAR test bytes | INFECTED, checksum matched,99ms |
| Truncated PDF | 422, no CLEAN,72ms |
| Unsupported MIME | 415, no CLEAN,48ms |
| Explicit clean retry | CLEAN,36ms |
| Wrong authorization | 401 |
| Owned daemon socket temporarily unavailable | health/scan503, no CLEAN |
| Owned daemon SIGSTOP | health503 in2257ms, scan503 in2107ms |
| Daemon resumed | All seven normal/recovery checks passed again |

Protected phase receipts are under the existing operator scanner-acceptance
directory, mode0600; no token or document bytes are in these repository facts.
The last resumed/recovery probe occurred20:42:12UTC after the paused chat resumed;
do not misrepresent this as a short continuous Production recovery exercise.

An actual FreshClam check at20:42UTC completed successfully through HTTPS fallback
after a DNS-query warning. It reported daily28163, main63, bytecode339 up-to-date.
An actual clamdscan --reload returned0; a subsequent normal recovery phase passed.
This proves local refresh/reload operation with the current database, not receipt
of a future new signature database or a hosted update/monitoring SLA.

## Resource And Load Limits: Explicitly Not PASS

Observed container snapshots:1.065GiB idle,1.396GiB during reload,1.958GiB during
the later load interval, then1.034GiB. These are samples, not a measured maximum.
Definitions volume108MiB. No Railway bill or hosted0.5vCPU capacity is inferred.

A valid small synthetic PNG returned CLEAN in3044ms. A10MiB synthetic PDF through
the VM port forward exceeded the12second client deadline; subsequent immediate
probes received429 until the outstanding operation settled. A separate10MiB
in-container request also exceeded12seconds; a later1MiB padded-PDF probe returned
CLEAN in1741ms. No CLEAN/VERIFIED was invented for either timed-out request and
no timeout was increased. The20-request/8-parallel load sequence is NOT a success;
it was gated by the outstanding request. Hosted sizing, maximum-file latency,
reload interference and real application/private-storage lifecycle remain to be
accepted on the proposed approved host. This limitation must survive handoff.

## Local Source Checks And Review

- Targeted scanner/document/acceptance/collector suite:37/37, skipped0, fail0.
- Current-source concurrency/replay subset:5 rounds of3 tests,15/15, skipped0.
  Earlier broader28-test repeats are separate dated evidence, not substituted.
- Typecheck, targeted ESLint, diff-check and production build passed. The build
  dependency-boundary check inspected118 manifests and found0 forbidden packages.
- Independent scoped review found P0/P1/P2=0 after fixing missing clamdscan and
  replay-before-live-health ordering. Final review also checked strict ISO metadata
  and whitelisted engine/signature audit evidence; no professional signature.

Final whole-platform CI, PostgreSQL integration, authenticated hosted successor
UAT and full final-diff review have NOT been assigned the old48/8a results.
No merge, paid resource, release or real-organization activation is authorized
by these local observations.

## Cleanup

The owned test container and definitions volume were removed; both task-created
VMs were stopped/deleted and the private host/guest token/env files removed.
Final owned Lima instance list was empty. Container force removal reported a
cleanup timeout before returning success, so the VM was additionally stopped and
deleted rather than assuming background cleanup. Sanitized receipts remain;
no customer database, shared host or paid service was involved.
