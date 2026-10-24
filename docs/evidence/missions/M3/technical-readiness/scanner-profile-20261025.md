# 10 MiB Diagnosis And Zero-Spend Preparation

Local date October25, UTC observations October24 21:12-21:20.
Actual synthetic Linux tests only; no hosted service or Production mutation.
Owner rejected the proposed additional80USD budget. It remains unauthorized.

## Diagnosis

The historical probe did not capture phase timings, so its exact individual
request cannot be reconstructed. The failure mechanism was reproduced with
measured stage times, not assumed to be a network timeout:

| Configuration / fresh file | Health | Ingress/buffer/checksum/format | Engine | Client total | Result |
| --- | --- | --- | --- | --- | --- |
| HTTP with simulated immediate engine,10MiB | 0ms | 133-617ms | 0ms | 295-937ms | Transport baseline, not ClamAV acceptance |
| Real1CPU, concurrent reload enabled but idle | 8ms | 414ms | 5535ms | 6712ms | CLEAN |
| Real0.5CPU, idle | 7ms | 494ms | 7919ms | 8930ms | CLEAN |
| Real0.5CPU, concurrent reload in progress | 3ms | 1091ms | 10015ms | 12221ms | Deadline/ERROR, never CLEAN |
| Serial reload,2GiB/1CPU, fresh10MiB | 3ms | 252ms | 3481ms | 3947ms | CLEAN |
| Serial reload, after actual reload, different fresh10MiB | 22ms | 238ms | 7282ms | 7823ms | CLEAN |

The reproduced bottleneck is engine CPU contention during concurrent signature
reload, with upload/validation consuming additional deadline budget. The engine
child is killed at10seconds; client bound remains12seconds. Warm daemon health
was established before baseline scans, excluding cold startup from these measured
rows. Original post-xref-padding input also passed independently; a valid content
stream with correct Length/xref was added to avoid depending on a malformed fixture.
Per-run randomized valid whitespace avoids confusing cache hits with cold scans.
Cache-hit measurements1219ms/499ms/355ms are NOT cold-throughput evidence.

## Fix And Tradeoff

`ConcurrentDatabaseReload no` uses the supported serial-reload mode: it avoids
loading a second engine while accepting scans. `TestDatabases yes` is preserved.
No10MiB reduction, scan-limit removal, synthetic CLEAN, larger timeout or disabled
download verification. [ClamAV guidance](https://docs.clamav.net/manual/Installing/Docker.html).

Actual serial reload:49561ms;19 readiness probes unavailable; recovery succeeded;
sampled reload maximum1074884608bytes; OOM/oom_kill0. Thus an update can temporarily
block new uploads/rescans, which must return the existing retryable scanner error.
Existing verified documents remain valid. This is an explicit availability tradeoff,
not continuous-scan availability or an SLA. Test files after recovery passed.

Serial image manifest:
`sha256:6055162e1994be7cd2f58fec95c7e520e8835864479a490b9a08ac1914c85a5b`.
Same official Node base as October24; Debian ClamAV1.4.6, signatures28163.
The benchmark mounts only owned source/profiling code; it never mounts customer data.

## Measured Consumption Versus Resource Envelope

- Actual verified cgroup limits:2147483648bytes and100000/100000 CPU quota,
  i.e.2GiB/1vCPU. This is the smallest tested complete scan/reload contour,
  NOT a proof that every smaller limit fails or that future signatures fit forever.
- Largest25ms sampled cgroup usage in final post-reload scan1235705856bytes
  (about1.151GiB), including the benchmark client. Baseline scan sample1204146176.
- Reload sample1074884608bytes. These are sampled maxima, not kernel-certified
  absolute peaks; this Linux kernel does not expose memory.peak. OOM counters0.
- Definitions108MiB currently; a1GB volume remains an operating allowance, not
  measured contents or permission to create a volume. Future growth, FreshClam
  validation, buffers and cache need headroom and monitoring.
- The earlier4GiB/0.5vCPU proposal was a maximum resource envelope, not measured
  average consumption or a necessary minimum monthly bill.0.5CPU is specifically
  NOT accepted for the demonstrated reload-overlap workload.

For scale only, IF billed average RAM were1.2GB continuously, at the current public
0.00000386USD/GB-second rate the RAM component is12.006144USD/30days. This is a
sensitivity calculation, not a measured monthly average. One observed cold scan
used7.814796 whole-container CPU-seconds including its client;500 such operations
would cost0.030165USD CPU, excluding updates, idle work, traffic and other files.
Never charge or forecast an entire vCPU-month merely because quota permits1vCPU.
Nor infer a free service from included credit. Existing paid eligible spare hosting
has not been established. Final hosting/configuration/load acceptance is still open.

## Regression, Review And Current Evidence Boundary

New profiler records separate phases, CPU and memory without secrets; it binds
state per request, tracks completion in finally, and stops rather than fabricating
remaining results after an unsettled operation. Tests cover both rejected and
unsettled engine/health calls, valid10MiB xref/length and unique protected config.
Independent review of final profiler/tests found P0/P1/P2=0; no professional verdict.
Targeted scanner/collector/acceptance/profile suite25/25 PASS, skipped0, fail0;
typecheck/targeted lint PASS. Production source files changed only the reload flag
relative to checkpoint283; the new profiler is operator/local-only code.

Old implementation48 UAT/CI remains historical. A final-head CI must run after the
single push; source-parity validation must not be bypassed or old UAT relabeled.
The root packet is not proof of successor hosted acceptance. No merge/deploy.

## Scheduled Retention

At this preparation interval00:20 Moscow the October25 window06:00-07:35 had not
occurred. No durable cron receipt exists yet. Existing monitor remains ACTIVE with
the collector and unchanged schedule. It must capture provider-correlated request
type, request/deployment IDs, status and actual fixed cleanup diagnostics in that
window, then retain sanitized evidence. Neither this profile nor a manual cleanup
call is cron proof. No paid observability or new scheduler has been enabled.
