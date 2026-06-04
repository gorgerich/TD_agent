# Тихий дом — B2B-платформа для агентов

B2B-расширение поверх существующей B2C-БД tihiydom (Next 16, React 19, Prisma 5).
Общая PostgreSQL-БД с прод-B2C: таблицы `User`, `Order`, `Payment` — **чужие, не трогаем**.
Наши — аддитивные B2B-таблицы (`Agent`, `ClientLead`, `Meeting`, `Quote`, `QuoteVersion`,
`Commission`, `Payout`, `AgentSession`, `OtpToken`, `AgentTier`, `Signature` + enums).

## Database safety (current state)

> **Temporary safety state:** Vercel build does not apply database schema changes.
> Schema changes must be applied only through the documented migration workflow
> after verified backup and baseline. Do not rely on deploy to mutate the database.

Текущий `build` = `prisma generate && next build` — **db push удалён** (hotfix
`#3`, merged). Деплой больше **не мутирует** БД на этапе сборки.

> ⚠️ **CONFIRMED — Preview и Production делят одни DB-переменные.** Аудит
> (`vercel env ls`) показал: `DATABASE_URL` и `DATABASE_URL_UNPOOLED` заданы одним
> значением на оба окружения (Production + Preview). Сборка больше не делает
> `db push`, поэтому preview-**билд** не мутирует прод. **Но preview-рантайм всё
> ещё подключается к прод-БД** (общий env) — читает/пишет боевые данные.
>
> **Preview DB обязательно изолировать перед реальным использованием previews:**
> - включить Neon **«branch per preview deployment»**, либо
> - задать **Preview-scoped** `DATABASE_URL` + `DATABASE_URL_UNPOOLED` на отдельную
>   Neon-ветку; **Production-scoped** оставить на прод.
> - после изоляции `vercel env ls` должен показать **отдельные** строки Production и Preview.

## Database migration workflow

> **Полный owner-runbook (BLOCKER + проверки окружения + шаги 0–6):**
> [`docs/db-migrations-runbook.md`](docs/db-migrations-runbook.md). Перед любым
> переходом на `migrate deploy` владелец проверяет scoping Vercel-env и делает
> бэкап — см. секцию BLOCKER.

> **Правило №1: НИКОГДА `prisma db push` против общей prod-БД.**
> Только аддитивные миграции (`migrate deploy`). Никаких изменений типов/`DROP` на
> существующих B2C-полях.

Целевая сборка (после бейзлайна, отдельным PR) применяет миграции декларативно:

```
build = prisma generate && prisma migrate deploy && next build
```

`migrate deploy` применяет только новые, ещё не применённые миграции из
`prisma/migrations/`. Он **не** пересоздаёт существующие таблицы и **не** делает
`db push`-подобной синхронизации. Переключение — **только после** прод-бейзлайна
(`scripts/db/baseline-prod.sh`) и зелёной staging-проверки.

### Подключения (Neon на Vercel)

| Переменная               | Назначение                                    |
|--------------------------|-----------------------------------------------|
| `DATABASE_URL`           | пулинговый (pgBouncer) — рантайм приложения    |
| `DATABASE_URL_UNPOOLED`  | непулинговый (direct) — `directUrl` для миграций |

`schema.prisma` использует `directUrl = env("DATABASE_URL_UNPOOLED")`. Миграции
всегда идут по непулинговому соединению (pgBouncer ломает advisory-locks Prisma).

### One-time baseline (выполняет владелец БД, с бэкапом)

Прод исторически синхронизировался через `db push`, истории миграций нет. Перед
переходом на `migrate deploy` нужно «забейзлайнить» текущее состояние прода, чтобы
deploy не пытался пересоздать уже существующие таблицы.

Скрипт `scripts/db/baseline-prod.sh` делает это **безопасно** (read-only +
metadata-only запись):

1. **Требует подтверждение, что есть проверенный бэкап** и верный хост.
2. Генерирует `prisma/migrations/0_init/migration.sql` из **живой prod-схемы**
   (`migrate diff --from-empty --to-url $DATABASE_URL_UNPOOLED` — только чтение).
3. Проверяет drift между prod и `schema.prisma`
   (`migrate diff --from-url … --to-schema-datamodel schema.prisma`). Если diff
   непустой — **останавливается**: нужен ручной аудит и аддитивная reconcile-миграция.
   Любой `ALTER`/`DROP` по `User`/`Order`/`Payment` — стоп-сигнал.
4. Помечает `0_init` как **applied** (`migrate resolve --applied 0_init`) — это
   пишет одну строку в `_prisma_migrations`, **никакого DDL** против прода.

```bash
# на машине с доступом к prod, после бэкапа:
export DATABASE_URL=...            # pooled
export DATABASE_URL_UNPOOLED=...   # direct
./scripts/db/baseline-prod.sh
```

После бейзлайна закоммить `prisma/migrations/0_init/` в репозиторий.

> **Почему не `--from-empty --to-schema-datamodel schema.prisma` для бейзлайна?**
> Это сгенерировало бы *целевую* схему (B2C+B2B). Она совпадёт с прод **только если**
> прошлый `db push` отработал полностью и без дрейфа. Бейзлайним от **реального**
> состояния прода (`--to-url`) и отдельно проверяем дрейф — так баг не маскируется.
>
> Поэтому локально-сгенерированный `0_init` (из `schema.prisma`) в репозиторий
> **не коммитим** — его создаёт `baseline-prod.sh` из живого прода.

### Последующие изменения схемы (нормальный цикл)

```bash
# 1. редактируешь prisma/schema.prisma (только аддитивно!)
# 2. локально, против dev/branch-БД (НЕ прод):
npx prisma migrate dev --name <краткое_имя>
# 3. ревью сгенерированного prisma/migrations/<ts>_<имя>/migration.sql:
#    — никаких DROP COLUMN / ALTER TYPE по B2C-таблицам
#    — новые колонки B2C должны быть nullable или с DEFAULT
# 4. коммит миграции → merge → (после флипа build) Vercel запустит migrate deploy
```

### Проверка на staging/branch-БД перед prod

Neon branching или отдельная staging-БД:

```bash
export DATABASE_URL_UNPOOLED=<branch-direct-url>
npx prisma migrate deploy      # прогон на копии
npx prisma migrate status      # должно быть "Database schema is up to date!"
```

Только после зелёного staging — merge в прод.

## Скрипты

| npm script        | действие                                  |
|-------------------|-------------------------------------------|
| `dev`             | `next dev -p 3001`                         |
| `build`           | `prisma generate && next build` (db push удалён; migrate deploy — цель после бейзлайна) |
| `prisma:deploy`   | `prisma migrate deploy` (ручной, не вызывается build)  |
| `test`            | node:test suite (`tests/*.test.ts`)        |
