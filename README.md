# Тихий дом — B2B-платформа для агентов

B2B-расширение поверх существующей B2C-БД tihiydom (Next 16, React 19, Prisma 5).
Общая PostgreSQL-БД с прод-B2C: таблицы `User`, `Order`, `Payment` — **чужие, не трогаем**.
Наши — аддитивные B2B-таблицы (`Agent`, `ClientLead`, `Meeting`, `Quote`, `QuoteVersion`,
`Commission`, `Payout`, `AgentSession`, `OtpToken`, `AgentTier`, `Signature` + enums).

## Database migration workflow

> **Правило №1: НИКОГДА `prisma db push` против общей prod-БД.**
> Только аддитивные миграции (`migrate deploy`). Никаких изменений типов/`DROP` на
> существующих B2C-полях.

> **СТАТУС (сейчас):** `build` всё ещё `prisma db push --skip-generate` (см. таблицу
> «Скрипты»). Переключение на `migrate deploy` — **только после** того как владелец
> выполнит `scripts/db/baseline-prod.sh` на проде (с бэкапом) и пройдёт
> staging-проверку. До этого момента сборку не трогаем.

Целевая сборка (после бейзлайна) применяет миграции декларативно:

```
build = prisma generate && prisma migrate deploy && next build
```

`migrate deploy` применяет только новые, ещё не применённые миграции из
`prisma/migrations/`. Он **не** пересоздаёт существующие таблицы и **не** делает
`db push`-подобной синхронизации.

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

### Последующие изменения схемы (нормальный цикл)

```bash
# 1. редактируешь prisma/schema.prisma (только аддитивно!)
# 2. локально, против dev/branch-БД:
npx prisma migrate dev --name <краткое_имя>
# 3. ревью сгенерированного prisma/migrations/<ts>_<имя>/migration.sql:
#    — никаких DROP COLUMN / ALTER TYPE по B2C-таблицам
#    — новые колонки B2C должны быть nullable или с DEFAULT
# 4. коммит миграции → merge → Vercel build запустит migrate deploy
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
| `build`           | сейчас `prisma db push --skip-generate`; цель — `migrate deploy` (после бейзлайна) |
| `prisma:deploy`   | `prisma migrate deploy`                    |
| `test`            | node:test suite (`tests/*.test.ts`)        |
