# Pilot scope

## Scenario A: cremation

1. Intake: identify decision-maker, deceased, contacts, location, timing and constraints.
2. Plan: select cremation and produce its scenario checklist.
3. Quote: build a draft from versioned catalog items; resolve every required price.
4. Agreement: publish an immutable quote version and expose only it to the client.
5. Contract: create/sign against the published quote version.
6. Payment: append entries to a ledger; derive unpaid, partial or paid status.
7. Execution: complete verified document and operational requirements.
8. Closure: close only after scenario guards pass and retain an auditable history.

Required pilot checkpoints: identity/death documents, cremation authorization and
scenario-specific operational confirmation. Exact legal document rules require
ritual-operations and legal sign-off in the dedicated document-control week.

Proposed closure guard IDs:

- `identity_verified`
- `death_document_verified`
- `cremation_authorization_verified`
- `crematorium_confirmed`
- `contract_signed`
- `payment_satisfied`

## Scenario B: burial in an existing family/related plot

1. Intake: identify decision-maker, deceased, plot owner/right holder and relationship.
2. Plan: select family/related plot burial and produce its scenario checklist.
3. Quote: build a draft from versioned catalog items; resolve every required price.
4. Agreement: publish an immutable quote version and expose only it to the client.
5. Contract: create/sign against the published quote version.
6. Payment: append entries to a ledger; derive unpaid, partial or paid status.
7. Execution: verify plot/relationship requirements and operational readiness.
8. Closure: close only after scenario guards pass and retain an auditable history.

Required pilot checkpoints: identity/death documents, plot entitlement/relationship
evidence and cemetery confirmation. Exact legal rules require specialist sign-off.

Proposed closure guard IDs:

- `identity_verified`
- `death_document_verified`
- `plot_entitlement_verified`
- `relationship_verified`
- `cemetery_confirmed`
- `contract_signed`
- `payment_satisfied`

## Shared flow invariant

`intake -> plan -> quote draft -> published quote -> contract -> payment -> execution -> closure`

Skipping a node is forbidden unless a versioned scenario policy explicitly permits it.
UI navigation is not authority to change domain state.

## Out of scope for the first 12 weeks

- Burial in a new plot and every scenario beyond the two above.
- Marketplace, supplier bidding and vendor settlement automation.
- AI recommendations or autonomous case decisions.
- Advanced 3D configurator work and new visual product categories.
- Full accounting/ERP, payroll and commission policy engine.
- Legal conclusions without human legal sign-off.
- Native mobile applications, offline mode and broad public self-service.
- Arbitrary workflow builders and enterprise customization.
- Migration of real production data before integrity, security and rehearsal gates pass.

## Success boundary

The pilot succeeds when 20 agents can complete these two scenarios without impossible
states, spreadsheet shadow systems, draft leakage or untraceable financial changes.
