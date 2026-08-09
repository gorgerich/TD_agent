# M2 independent review

## Released implementation

The original M2 independent adversarial review closed after seven rounds. P1 trend:
`5 -> 3 -> 1 -> 1 -> 0 -> 1 -> 0`; P0 remained 0. Final reviewed source SHA:
`e8851357047c44547bc1d2fa7352be69940c747d`. Historical findings and accepted P2 items
remain in `test-results.json`; they are not rewritten as if they never existed.

## Post-release audit

Audit base: `f6f3f17e984d7b1baaff619c9bcf063933e63e05`.

The independent audit found 0 P0 and 3 related P1 defects:

1. unknown client price could be rendered as a definitive economics total;
2. margin-only external expense was omitted from canonical cost;
3. incomplete editor state could make builder economics diverge from Published QuoteVersion.

First repair source SHA: `84ad627c1044ced3037f1064560883a23cfdca40`.

Repair review round 1 on that source returned P0=0, P1=1 and P2=2:

- P1: immutable Published history was still recalculated with current rules;
- P2: secondary requested-price totals could display stale editor amounts;
- P2: the 200 percent zoom geometry could clip or overlap tabs and actions.

All three were fixed. A subsequent implementer review found one additional P1: canonical read
failure blocked autosave but still left manual save reachable. Source `f50cba21a6787ba46e155e111fea69d2424d772e`
closed that direct stale-handle path.

The next independent review returned P0=0, P1=2, P2=0. Both findings were incomplete
closure of the same canonical-authority defect class, not new money-model defects:

- review/presentation could issue their second mutation after the save response arrived on
  an unmounted route;
- a successful publish followed by a failed canonical refresh left stale write/link authority.

Canonical-authority source SHA: `0ea6cf2cfbe19875f0e19e6a36965f2728b891c0`.

That source binds every async commercial continuation to an exact successful
canonical-read generation. Route change, unmount, retry and failed refresh revoke it. Both
regressions passed five complete isolated commercial journeys with skipped=0 and residue=0.

Independent review on `0ea6cf2cfbe19875f0e19e6a36965f2728b891c0` returned P0=0,
P1=0 and P2=1. The P2 was a stale false failure toast that could appear after navigation
when a browser request rejected after the server had already accepted it.

First P2-closure SHA: `9d1b38aa95959b22e54487ba59c916496a0736bb`.

That P2 closure applies the same exact-authority check to async success/error feedback,
clipboard completion, delayed toast cleanup and pending-state finalizers. The regression is
asserted in the commercial browser journey. The first five-run sequence reached 4/5 before
the fifth run hit a persistent local rate-limit bucket: the fixture cleanup covered
`127.0.0.1` and `::1`, but not the IPv4-mapped `::ffff:127.0.0.1` key emitted by Next. Exact
synthetic cleanup was extended to that loopback key; the next 5/5 full journeys passed with
skipped=0, commercial residue=0 and rate-limit residue=0 after every run. No security limit,
assertion, timeout or production path was weakened.

Review on `9d1b38aa95959b22e54487ba59c916496a0736bb` returned P0=0, P1=0 and
one narrower P2: authority was checked before `Response.json()`, but could expire while the
body was still being read. Final repair source SHA:
`12cf2b3b6950cd320b237954871e8fbe44c70d2c`.

Both success and non-success response branches now re-check exact authority after body
parsing. The browser regression receives headers, delays the body, changes route authority,
then releases success and non-success JSON. It proves no second mutation, stale success/error
toast or pending-state leak. The first harness version mishandled Next's `fetch(URL)` and was
stopped by the zero-console-error assertion; support for `string`, `URL` and `Request` was
added without weakening assertions. The corrected full commercial journey passed 5/5 with
skipped=0 and zero residue after every run.

Final independent review covered the exact diff
`f6f3f17e984d7b1baaff619c9bcf063933e63e05..12cf2b3b6950cd320b237954871e8fbe44c70d2c`
and includes the prior P2 closure, money truth, internal-cost leakage, immutable history,
tenant boundaries, test weakening, mobile layout, fixture isolation and migration invariance.

Final result: P0=0, P1=0, P2=0, verdict `PASS`. The reviewer independently executed
commercial unit 18/18, browser syntax, diff, secret and prohibited-file checks. The reviewer
confirmed no skip, `.only`, serialization, concurrency, timeout, migration, schema, workflow,
dependency or production-behavior change. The implementer's DB-backed browser evidence remains
the 5/5 full-journey result above; the reviewer did not falsely claim to rerun that long gate.
