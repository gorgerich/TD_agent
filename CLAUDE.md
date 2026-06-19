# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

## What this is

**«Тихий дом для агентов»** (`tihiydom-agents`) — a B2B agent portal built on top of
the existing B2C funeral-arrangement service tihiydom.com (Moscow / Moscow region,
ИП Пачулия). Field agents visit a client at home; during the meeting the client
assembles their own estimate (the agent guides), then signs and pays on the spot.

The UI and most domain content are in **Russian** — match that language in
user-facing strings, labels, and copy. Code identifiers and comments are mixed
RU/EN; follow the convention of the file you are editing.

> Read `HANDOFF.md` and `prisma/schema.prisma` together with this file — they carry
> the project decisions, open blockers, and the rationale behind the data model.

## Tech stack (the actual versions, not the brief)

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Prisma 5** ORM against **PostgreSQL** (shared with B2C — see constraints below)
- **Tailwind CSS v4** (via `@tailwindcss/postcss`) + CSS Modules for component-scoped styles
- **Zod 4** for request validation
- **@phosphor-icons/react** for icons; `next/font/google` (Onest / Source Serif 4 / JetBrains Mono)
- **Playwright** (dev dependency) for browser checks
- Deploy target: **Vercel**. Dev/prod server runs on **port 3001**.

## Commands

```bash
npm install                 # postinstall runs `prisma generate`
npm run dev                 # next dev on port 3001
npm run build               # prisma generate + prisma db push + next build
npm run start               # next start on port 3001
npm run lint                # eslint .
npm run prisma:generate     # regenerate Prisma client after schema edits
npx prisma validate         # validate schema (needs DATABASE_URL filled)
```

There is no unit-test runner configured. Validate changes with `npm run lint`,
`npm run build`, and `npx prisma validate`; use Playwright / the dev server for
manual UI verification.

### Local setup

```bash
cp .env.example .env        # fill DATABASE_URL and the direct URL (see note below)
npm install
npm run prisma:generate
npx prisma validate
npm run dev                 # http://localhost:3001  → redirects to /agent/dashboard
```

## Repository layout

```
app/
  page.tsx                  # root → redirects to /agent/dashboard
  layout.tsx                # root layout: fonts, lang="ru", global noindex
  globals.css               # Tailwind v4 + design tokens
  agent/
    login/                  # email+password / OTP login
    configurator/           # standalone 3D/2.5D ritual configurator page
    (app)/                  # authenticated agent cabinet (route group)
      layout.tsx            # AUTH GUARD (server) + sidebar + onboarding tour
      dashboard/ leads/ meetings/ commissions/
      meeting/[meetingId]/quote/   # in-meeting estimate builder (QuoteBuilder)
  co/[code]/                # client-facing "estimate mirror" (co-browse, no auth)
  api/
    agent/auth/             # login, logout, register, request-otp, verify-otp, demo
    agent/leads|meetings|commissions|onboarding/   # cabinet data APIs
    agent/meeting/[meetingId]/quote|session/       # quote + co-browse state
    co/[code]/              # client co-browse read/patch (access by meeting code)
    webhooks/order-complete/                        # payment/order webhook
lib/                        # server + shared logic (see below)
components/                 # AttributePicker, AttributeRender, configurator/, visualizer/
prisma/schema.prisma        # B2C (mirrored) + B2B (new) — single source of DB truth
proxy.ts                    # lightweight middleware: noindex header only
public/                     # configurator/visualizer assets + robots.txt (noindex)
.codex/skills/ui-ux-pro-max # design-system reference data (not app code)
```

### `lib/` — key modules

- `prisma.ts` — singleton `PrismaClient` (avoids hot-reload connection storms).
- `auth.ts` — `getAgentSession()` / `getSessionFromRequest()`, `Role` type. **In
  `development` it returns a mock `DEV_SESSION` when no cookie is present**, so the
  cabinet renders without login locally. Production requires a valid session.
- `session.ts` — stateless HMAC-signed session token (Web Crypto, edge-safe),
  cookie `tihiydom_agent_session`, 8h TTL. Signed with `APP_ENCRYPTION_KEY`.
- `agentAuth.ts` — session cookie helpers, email/phone normalization, tier upsert.
- `password.ts` — PBKDF2 (sha256, 210k iters) hashing/verify, `pbkdf2$…` format.
- `demo.ts` — idempotent demo-agent + seed data, gated by `DEMO_MODE=1`.
- `coSession.ts` — co-browse meeting state, persisted in `AgentSession` (DB, **not**
  in-memory — serverless instances don't share memory). `CoState` is JSON.
- `calculationUtils.ts` — **mirror** of `gorgerich/frontend/.../calculationUtils.ts`.
  Keep it in sync manually; the only intentional change is exporting
  `DEFAULT_CALCULATOR_CONFIG`. B2C and B2B must compute the same estimate.
- `attributes.ts` — ritual-attribute catalog for the configurator/co-browse.
- `tour.ts` — onboarding tour steps.

## Conventions & patterns

- **Path alias:** import from `@/…` (maps to repo root, see `tsconfig.json`).
- **API routes:** validate input with **Zod** `safeParse`; return
  `NextResponse.json({ error }, { status })`. Standard codes used: `400` invalid
  input, `401` unauthorized, `403` inactive profile, `404` not found, `503` DB
  unavailable. Wrap Prisma calls in `try/catch` and degrade gracefully.
- **Auth in routes:** call `getSessionFromRequest(req)` (API) or `getAgentSession()`
  (server components); scope every query by `session.agentId`.
- **Auth guard location:** enforced in the **Node runtime** at
  `app/agent/(app)/layout.tsx`, *not* in `proxy.ts` — the edge runtime read
  `APP_ENCRYPTION_KEY` unreliably and broke session verification. Keep auth checks
  in Node.
- **Routes needing dynamic data:** set `export const runtime = "nodejs"` and/or
  `export const dynamic = "force-dynamic"` as the existing routes do.
- **Money:** `Order.totalAmount` / `Payment.amount` and DB totals are in **kopecks
  (Int)**. The configurator/`calculationUtils` work in **rubles** — convert at the
  boundary; don't mix units.
- **JSON columns** (`Order.meta`, `QuoteVersion.payload`, `AgentSession.state`) are
  stored as **JSON strings**, not native JSON — `JSON.stringify`/`parse` explicitly.
- **Styling:** colocated CSS Modules (`*.module.css`) per route/component, plus
  Tailwind utilities. Design tokens live in `app/globals.css`.
- **No indexing:** the whole B2B zone is `noindex` (root layout metadata,
  `next.config.ts` X-Robots-Tag header, `proxy.ts`, `public/robots.txt`). Preserve this.

## Data model rules (read before touching `prisma/schema.prisma`)

The DB is **shared with the B2C service**. The B2C tables (`User`, `Order`,
`Payment`) are mirrored from `gorgerich/frontend` and must stay compatible.

- **Never change the type of an existing B2C field.** B2B additions are additive:
  new tables, new enums, and **nullable** columns on existing tables only.
- `Order.status` stays a **`String`** (not an enum) — B2C code reads it. Allowed
  values are documented in a comment in the schema.
- All new foreign keys are **`Int`** (User/Order use `Int @autoincrement`, not cuid).
- New B2B models: `Agent`, `AgentTier`, `ClientLead`, `Meeting`, `Quote`,
  `QuoteVersion`, `Signature`, `Commission`, `Payout`, `AgentSession`, `OtpToken`.
- `datasource.directUrl` reads **`DATABASE_URL_UNPOOLED`** (Neon/Vercel injects it;
  `.env.example` still calls it `DIRECT_URL` — reconcile when filling `.env`).

### Migration safety — CRITICAL

- **Do NOT run `prisma migrate` or `db push` against the production DB** — it is
  shared with B2C. Use a separate local dev database.
- Apply schema changes to prod **only via additive migration** (`prisma migrate
  deploy`) after a backup, never an interactive `db push`.

## Privacy & compliance (ФЗ-152 / 54-ФЗ)

- Client and deceased personal data (`ClientLead.context`, co-browse state) is PII —
  encrypt at the application layer; co-browse state expires via `AgentSession.expiresAt`.
- Co-browse is deliberately a **"mirror of the estimate"**, not screen-share.
- Fiscalization (receipts), e-signature (ПЭП), and SBP payment flows have open
  legal/business blockers — see `HANDOFF.md`. Don't hardwire decisions that those
  blockers gate (agent model, offer terms, who receives payment).

## Hard constraints

- `gorgerich/frontend` (the B2C repo) is **read-only reference — do not modify it.**
- Keep `lib/calculationUtils.ts` in sync with the B2C original.
- Don't introduce screen-share / video co-browse (PII risk under ФЗ-152).
- Preserve the noindex posture across the B2B zone.

## Environment variables

See `.env.example`. Key ones:

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED` (a.k.a. `DIRECT_URL`) — Postgres connection.
- `APP_ENCRYPTION_KEY` — 32-byte base64 key; signs sessions and encrypts PII.
  **Required in production** (`session.ts` throws if missing); dev falls back to a
  hardcoded dev key.
- `DEMO_MODE=1` — enables the demo agent / seed login (showcase, not a real login).
- `SMS_PROVIDER_API_KEY`, `SBP_WEBHOOK_SECRET` — filled at signing/payment stages.

## Git workflow

Commit messages follow a loose Conventional-Commits style with scopes, e.g.
`feat(agent): …`, `fix(co-view): …`, `ux(quote): …`. Keep that convention.
Do not push to `main` without explicit permission; develop on the assigned branch.
