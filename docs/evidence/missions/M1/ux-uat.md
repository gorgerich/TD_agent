# Mission 1 UX and UAT contract

## Agent critical path

1. Open Today and scan Today, Overdue, Upcoming and Waiting/Blocked work.
2. See owner, due time, source, reason and expected outcome without opening a row.
3. Follow a deep link to the correct Case or Meeting context.
4. Execute a concrete action and record outcome; no generic `Отметить` action.
5. Recover visibly from API error, conflict, offline state or permission denial.

## Manager critical path

1. Open Team Control Tower and scan unassigned work, SLA risk, ceremonies and
   capacity by agent.
2. Assign or reassign a task/case with a required reason.
3. See the queue update and immutable audit entry from the same accepted mutation.
4. Search for a Case/client/Task/Meeting and save the current operational view.

## Interaction standards

- Russian locale, 24-hour time and explicit organization timezone.
- Tentative meeting can exist without invented start time.
- Keyboard-visible focus and logical tab order.
- Critical path usable at 200% zoom and narrow mobile width.
- Content visible by default; motion cannot gate controls or text.
- Loading, empty, error, retry, conflict, offline and permission states are distinct.
- No internal margin, cost, budget or family-sensitive data enters manager queue or
  client surfaces unnecessarily.

## Synthetic UAT

- Cremation: intake -> operational plan -> assigned tasks -> tentative and confirmed
  meeting -> outcome -> ready for commercial step.
- Relative burial: intake -> operational plan -> manager reassignment -> overdue
  escalation -> outcome -> ready for commercial step.

## Exact Preview result

Status: `PASS`.

- implementation SHA: `a2c1f603e8ae2e506be981de265b75d9373a5387`;
- deployment: `dpl_93zVXvz1eMywgJ5LKcE5BE9n423P`;
- URL:
  `https://td-agent-m1-uat-20260719-c3ghbzsoy-rics-projects-9baa2793.vercel.app`;
- protection method: authenticated Vercel automation bypass, secret not persisted
  in Git or evidence.

Authenticated results:

| Scenario | Result |
| --- | --- |
| Agent Today, outcome and offline recovery | PASS |
| Manager control tower, assignment and audit | PASS |
| Cremation | PASS |
| Relative burial | PASS |
| Assigned-agent reduced case context | PASS |
| Conflict recovery | PASS |
| Command palette keyboard/focus behavior | PASS |
| Mobile width | PASS |
| 200% zoom | PASS |
| WCAG critical/serious | 0 / 0 |
| Skipped | 0 |

Visual screenshots covered Today, Cases, open Case and Team Control Tower on
desktop plus Today and Team on 390 x 844 mobile. Content remained visible by
default; no horizontal overflow, clipped text, incoherent overlap or inaccessible
focus state was found. Navigation styling follows the previously approved filled,
high-weight icon direction rather than introducing a second icon language.
