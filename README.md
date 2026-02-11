# RecruitFlow

Старт нового проекта по ТЗ `v1.1` от `10.02.2026`.

## Что уже заложено

- monorepo (`apps/api`, `apps/web`, `packages/contracts`)
- API на TypeScript + Fastify с health/readiness endpoint
- API-модули: `auth`, `jobs`, `flow-runner (start/save/next/submit/resume magic-link + branching)`, `webhook outbox (queue/retry/dispatch)`
- SQL-схема Postgres под ключевые сущности из приложения A
- Docker Compose для Postgres и Redis
- Документация: MVP scope, roadmap, требования

## Быстрый старт

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api
```

Health check:

```bash
curl http://localhost:8080/health
```

## Структура

- `apps/api` - backend API (RBAC, jobs, flow runner, ATS)
- `apps/web` - фронтенд (candidate flow + HR cabinet)
- `packages/contracts` - общие DTO/типы событий
- `infra/postgres` - миграции SQL
- `docs` - extracted requirements и план работ

## Следующие шаги

1. Подключить ORM и миграции (`drizzle` или `prisma`) поверх `infra/postgres/001_init.sql`.
2. Реализовать auth + tenant isolation middleware.
3. Запустить модуль `Jobs` (CRUD + public_slug + UTM link builder).
4. Добавить Flow Builder/Runner в MVP-версии.
