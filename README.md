# Тихий дом — B2B-платформа для агентов

B2B-расширение поверх общей с прод-B2C PostgreSQL-БД (Next 16, React 19, Prisma 5).

## Database safety (temporary state)

> **Temporary safety state:** Vercel build does not apply database schema
> changes. Schema changes must be applied only through the documented migration
> workflow after verified backup and baseline. Do not rely on deploy to mutate
> the database.

Build no longer runs `prisma db push` (removed in
`hotfix/remove-db-push-from-build`). Reason: Vercel Preview and Production share
the same `DATABASE_URL`/`DATABASE_URL_UNPOOLED`, so a build-time `db push` ran
against the production DB on every deploy — including previews. The migration
workflow (baseline → `migrate deploy`) is prepared separately (PR #2) and applied
by the DB owner with a verified backup.
