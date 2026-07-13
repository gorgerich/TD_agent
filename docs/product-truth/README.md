# Product truth: Week 1

- `GOVERNANCE_MODE: SOLO_FOUNDER_AI_ASSISTED`
- `WEEK_STATUS: PASS`
- Verified implementation commit: `95d6dbd91cecdefeedc722ad27dcebb94ba15e27`
- Accepted gate baseline: `1fcdd9beea0f95fcec6c08ea40cf2ad8be9b0a5f`

This directory is the Week 1 contract for the TD Agent pilot. It converts the
CPO audit dated 2026-07-13 and the 12-week delivery gates into reviewable,
executable product rules. It does not claim that the current runtime already
implements those rules.

## Pilot decision

The Founder / Product Owner accepted exactly two scenarios:

1. Cremation.
2. Burial in an existing family/related plot.

No third scenario may enter the pilot without reopening product scope and its
operational validation.

## Documents

- [Pilot scope](./pilot-scope.md)
- [Domain glossary and stable identity](./domain-glossary.md)
- [Current-state inventory and sources of truth](./current-state-inventory.md)
- [UI status registry](./status-registry.md)
- [State model and transitions](./state-model.md)
- [Domain event catalog](./event-catalog.md)
- [Impossible-state matrix](./impossible-states.md)
- [Canonical mutation ADR](../adr/0001-canonical-domain-mutations.md)
- [Week 1 evidence](../evidence/week-1.md)
- [Week 1 governance decision](../evidence/week-1-signoff.md)
- [Risk register](../evidence/risk-register.md)

## Gate decision

Week 1 is `PASS` under `SOLO_FOUNDER_AI_ASSISTED` governance because the
technical implementation and CI passed, the Product Owner accepted the two
pilot scenarios and governance risk, and the deferred human reviews are
recorded as explicit blocking milestones.

The PASS does not waive these controls:

- human technical review before the Week 10 Gate and before a production
  real-data or payment pilot;
- ritual-operations SME validation before the Week 2 Gate can close.

Week 2 may start after Week 1 closure, but it cannot pass without the recorded
SME validation. No Week 2 implementation is part of this closure.
