# Product truth: Week 1

Status: `IN_PROGRESS`

This directory is the Week 1 contract for the TD Agent pilot. It converts the
CPO audit dated 2026-07-13 and the 12-week delivery gates into reviewable,
executable product rules. It does not claim that the current runtime already
implements those rules.

## Pilot decision

Exactly two scenarios are proposed:

1. Cremation.
2. Burial in an existing family/related plot.

They remain proposed until Product Owner and ritual-operations SME sign-off.
No third scenario may enter the pilot without reopening the Week 1 gate.

## Documents

- [Pilot scope](./pilot-scope.md)
- [Domain glossary and stable identity](./domain-glossary.md)
- [Current-state inventory and sources of truth](./current-state-inventory.md)
- [UI status registry](./status-registry.md)
- [State model and transitions](./state-model.md)
- [Domain event catalog](./event-catalog.md)
- [Impossible-state matrix](./impossible-states.md)
- [Canonical mutation ADR](../adr/0001-canonical-domain-mutations.md)

## Gate

Week 1 cannot pass until all of the following exist as written evidence:

- Product Owner sign-off.
- Tech Lead sign-off.
- Ritual-operations SME sign-off.
- Independent reviewer verdict.
- Green CI on a clean checkout.

Until then, the correct gate status is `IN_PROGRESS`, not `PASS`.
