# M2 release

Authoritative status as of 2026-08-02: `RELEASED`.

## Production truth

| Item | Verified value |
| --- | --- |
| Product PR | [#28](https://github.com/gorgerich/TD_agent/pull/28), merged |
| Product merge | `54da13348d0a983d44752c3683fb8a17c40683f2` |
| Current main | `f6f3f17e984d7b1baaff619c9bcf063933e63e05` |
| Production deployment | `dpl_38Ry4cPYMxL3xWStt4aM7nERR4ma`, READY |
| Production URL | `https://td-agent-9bx56sl3y-rics-projects-9baa2793.vercel.app` |
| Production Git SHA | `f6f3f17e984d7b1baaff619c9bcf063933e63e05` |
| Production database fingerprint | `0257665af2dd90a4` |
| Applied migrations | 10 |
| M2 migration checksum | `fc82c99f3fa06cd7a74d42917e82638923d543bb19b5150a1a9403183eb6999e` |
| Schema parity | PASS, `No difference detected` |
| Commercial orphan/duplicate/tenant mismatch | 0 |

The production deployment and database checks were read-only. This audit did not change
production data, schema, environment variables, or deployment.

## Post-release audit

Independent inspection of released main and adversarial review found five related P1 truth
defects:

1. unknown client price could still be rendered as a definitive economics total;
2. a margin-only external expense was dropped from canonical cost;
3. an incomplete legacy editor state could make the builder economics disagree with the
   immutable Published QuoteVersion;
4. history and client read models could recalculate a Published version using current rules;
5. a failed canonical read could leave a local fallback available for manual write.

Repair source commit: `12cf2b3b6950cd320b237954871e8fbe44c70d2c`.

The repair keeps one canonical money projection, excludes strict internal-cost-only lines
from presentation/client output, and replaces volatile local snapshots with checksum-verified
immutable QuoteVersion history. Failed canonical reads now hide totals and block every write
until a successful retry. Staged review/presentation actions are tied to the exact canonical
read generation, so route change cannot release a second mutation, and a failed post-publish
refresh removes stale publish/link authority. Unit 96/96, integration 44/44, all four browser
suites, mobile, accessibility, migration no-op, and schema parity gates pass on an isolated
database with skipped=0 and fixture residue=0. Both authority regressions passed five full
commercial journeys. The repair is not merged or deployed. Owner authorization is required.

Controlled production commercial write smoke remains `NOT_RUN`. No approved safe cleanup
exists for a production synthetic Quote/client-decision fixture, so this audit used
read-only production verification plus isolated browser UAT instead of creating business
records in production.

## CI history

The release merge CI passed:
https://github.com/gorgerich/TD_agent/actions/runs/30693286770

Current-main CI run 30716761666 stopped at evidence validation because `mission.yaml` used
the unknown state `PRODUCTION_RELEASE_BLOCKED`; later steps were skipped. This repair changes
the authoritative state to `RELEASED` and must obtain a fresh full CI with skipped=0 before
merge.

## Open governance

- `RISK-W1-TECH-HUMAN-REVIEW`: OPEN.
- M3 Fulfilment & Money Trust: NOT_STARTED.
- Production release or merge of the P1 repair: not authorized in this audit session.
