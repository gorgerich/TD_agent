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
