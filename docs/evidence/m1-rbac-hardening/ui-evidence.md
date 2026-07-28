# UI evidence

Desktop:

- `screenshots/platform-admin-desktop.png`
- `screenshots/organization-admin-desktop.png`

Mobile:

- `screenshots/platform-activation-mobile.png`
- `screenshots/platform-admin-mobile.png`
- `screenshots/organization-admin-mobile.png`

The browser gate verifies no horizontal overflow at 390 x 844, functional
navigation, real role/invite mutations on isolated data, server-confirmed
feedback, and forbidden screens for MANAGER and AGENT.

First-owner activation additionally verifies that the raw token disappears from
the browser URL, password requirements remain readable, CTA stays reachable,
automatic session redirect succeeds and consumed-token replay fails safely.
