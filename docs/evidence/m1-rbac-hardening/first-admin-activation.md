# M1 RBAC Hardening first platform admin activation evidence

## Provisioning contract

- Missing normalized User: created with `passwordHash=null`.
- Platform role: `SUPER_ADMIN`, assigned only by guarded operator bootstrap.
- Token: 32 cryptographically random bytes; database stores only SHA-256.
- Lifetime: 30 minutes.
- Re-bootstrap: revokes earlier unconsumed activation before issuing a new one.
- Existing password-enabled User: role assignment is idempotent; password hash
  is unchanged; no activation link is issued.
- Operator output: activation URL requires
  `CONFIRM_PLATFORM_ADMIN_ACTIVATION_OUTPUT=YES`; CI fails closed.

## Activation contract

- Route: `/setup/platform-admin`.
- Raw token arrives in URL fragment and is removed from browser history before
  verification.
- API accepts only strict `VERIFY` or `ACTIVATE` payloads; email and role are not
  accepted.
- Invalid, expired, revoked and consumed tokens use one safe error response.
- Verification: 10 attempts/minute per instance.
- Activation: 5 attempts/15 minutes per instance.
- Password: 12-128 characters, exact confirmation, obvious-password rejection.
- Existing PBKDF2 format and parameters are unchanged.
- Password hash is calculated before the transaction.
- Token consumption, password update and `PLATFORM_ACCOUNT_ACTIVATED` audit are
  atomic.
- Successful activation creates the ordinary signed session and redirects to
  `/platform-admin`.

## Verification

- Unit: token entropy/hash and password policy PASS.
- Integration: missing User, null password, role, hash-only storage, revocation,
  expiry, one-time consumption, login, redirect, existing-password preservation,
  mass-assignment rejection and rate limit PASS.
- E2E: mobile activation, URL cleanup, automatic session, platform redirect and
  replay rejection PASS.
- Agent and Manager auth regressions: PASS.
- Governance correction GitHub CI: `30353147176`, skipped `0`.
- Isolated Preview migration/repeated deploy/schema parity: PASS.
- Production DB/schema/deployment: unchanged.

Production provisioning and activation remain blocked pending a separate owner
approval and controlled release runbook.
