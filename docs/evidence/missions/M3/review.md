# M3 independent adversarial review

## Certified scope

- Base: `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`
- Reviewed implementation: `a917a1f10b959b80cd4e0a249a2d2281e0bba106`
- Reviewer: independent reviewer agent Huygens
- Final verdict: **PASS**
- P0: **0**
- P1: **0**
- P2: **0**

The reviewer read the exact diff rather than trusting the implementer summary, checked the M3
domain/security boundaries, and independently reran focused recovery contracts, lint, typecheck,
unit 122/122, and Production build.

## Findings closed before final review

- Signing retry could discard its idempotency key.
- Shared document recovery could be overwritten by concurrent UI actions.
- Execution retry reconstructed a payload from current props rather than retaining the original.
- Generic transport/5xx copy could claim a commit that was not confirmed.
- Non-retryable 4xx could leave a recovery lock active.

The certified source fixes these by retaining exact command envelopes, distinguishing confirmed
from unconfirmed recovery truth, using synchronous single-flight document mutation guards,
replaying the stored path/body/key directly, and clearing stale recovery on non-retryable errors.

## Final verification

- No weakened assertion or skipped test.
- Integration suite remains one normal `node --test` invocation with default concurrency.
- No timeout increase.
- No schema, migration, auth hash, security, or workflow change in the final recovery repair.
- No production behavior change outside the M3 command-recovery boundary.
- No tracked file modified by the reviewer.

Human Finance, Legal/Privacy, and Ritual SME verdicts are deliberately outside this technical
review and remain pending.
