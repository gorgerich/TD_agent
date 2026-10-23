# Finance E2E Initialization Repair

Source CI [39939428118](https://github.com/gorgerich/TD_agent/actions/runs/39939428118), bound to c6112aef978b6129b46df88b1ae914b150249b70, failed End-to-end tests at m3-fulfilment.mjs:386:19. Independent source-derived execution established a temporal-dead-zone ReferenceError: recordPayment was invoked before the let paymentNavigationAttempt declaration inside main. Navigation and its failure diagnostic were never reached. The earlier extracted VM diagnostic test preinitialized this counter and missed the defect.

The successor moves initialization beside the other counters, before any invocation. The ordering-aware regression extracts the actual declaration, first call and navigation function from the browser program and preserves their source ordering. The repaired source reaches goto and preserves the original failure; an invocation-before-initialization negative control throws ReferenceError with zero goto calls and zero diagnostics. Existing message/URL secrecy controls remain. No browser assertion, timeout, retry, application behavior or financial write was weakened.

Targeted successor diagnostics: 6/6 PASS, skipped0. Fresh full local, exact-head CI and native authenticated UAT remain required; this result does not certify them. The historical b001 navigation failure is still cause UNPROVEN, not explained by this subsequently introduced test defect.

Actual historical c611 CI: units291, latency124, canonical PostgreSQL207, targeted repeats575, all passed with skipped0. The first four E2E programs passed; M3 failed and CPO did not execute. Auth-failure/component/evidence steps were skipped. All four fixture cleanup steps succeeded. This CI is FAIL, not evidence-only failure.

Candidate9f70675's in-progress local gate and CI39991595383 were stopped after this defect was confirmed, before knowingly running the broken E2E. Local cleanup PASS. Their completed lint/typecheck steps do not turn the stopped aggregates into PASS. The subsequent fixed-tree run is separate evidence.

Production, schema, environment, freeze and NOX were not changed.
