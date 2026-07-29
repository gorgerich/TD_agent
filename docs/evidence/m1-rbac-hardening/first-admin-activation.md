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

## Existing-owner recovery supplement

- Implementation SHA:
  `c735dab4f1de6d1175dc0d53bd1f525c4497c1a0`.
- Existing first owner remains the only eligible recovery target; no additional
  User, Agent, Membership or Organization is created.
- Purpose-bound activation records separate `OWNER_RECOVERY` from
  `FIRST_ACCESS`.
- Recovery lifetime: at most 15 minutes.
- Recovery token: 32 cryptographically random bytes; only SHA-256 is stored.
- Operator issuance uses an exact production-origin guard, approved direct
  database fingerprint, advisory lock and persistent audit.
- URL is written once to a local `0600` file inside a `0700` directory. It is
  not printed to stdout, CI, GitHub, evidence or application logs.
- Token travels only in the URL fragment and is removed before API verification.
- Password, TOTP secret and recovery material are never accepted through chat or
  operator CLI.
- Eligibility is checked before PBKDF2 and rechecked atomically after hashing.
- Password change, TOTP enrollment, token consumption, audit and
  `sessionVersion` increment commit atomically.
- Session cookie is signed from the exact committed `sessionVersion`; concurrent
  revocation cannot resurrect a stale session.
- Persistent limits: 8 verification attempts per 15 minutes and 5 recovery
  attempts per 15 minutes.
- Freeze exception is restricted to the exact recovery endpoint. Other business
  writes remain fail-closed.

Verification:

- Unit: 67 passed, 0 failed, 0 skipped.
- Integration: 39 passed, 0 failed, 0 skipped.
- E2E: owner recovery, replay rejection, role preservation, stale-session
  rejection, mobile layout, Agent and Manager regression PASS.
- GitHub Quality:
  `https://github.com/gorgerich/TD_agent/actions/runs/30449276195`, PASS,
  skipped `0`.
- Independent review: P0 `0`, P1 `0`.
- Production recovery: NOT RUN.

## Restored-snapshot isolation repair

- Repair SHA: `934e7ff7ae82925418dfce588004a11fd0b080df`.
- Root cause: smoke-account integration setup deleted the global canonical
  release-smoke identity before every test. Empty CI databases hid the collision;
  a restored production snapshot exposed loss of one retained synthetic
  User/Agent/Organization/Membership.
- Repair: each integration process uses its own random `.invalid` identity.
  Cleanup selects only that exact identity and its exact related IDs.
- Canonical operator CLI identity and defaults are unchanged.
- Production snapshot counts remain exact after the full 39-test suite.
- Targeted lifecycle repeat: 5/5 PASS with canonical baseline preserved.
- Rehearsal: encrypted backup, real remote restore, additive migration,
  repeated no-op, schema parity and local restored-snapshot integration PASS.
- Repair CI:
  `https://github.com/gorgerich/TD_agent/actions/runs/30451594365`, PASS,
  skipped `0`.
- Independent repair review: P0 `0`, P1 `0`.
