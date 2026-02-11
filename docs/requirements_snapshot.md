# RecruitFlow Requirements Snapshot

Источник: ТЗ `SaaS-платформа автоматизации рекрутинга` версия `1.1` от `10.02.2026`.

## Product Goal

Конструктор рекрутинговой воронки, который позволяет HR за 20-30 минут запустить поток кандидатов, автоматически собирать ответы, скоринг, интеграции и вести кандидатов в ATS.

## Must-have modules (v1)

- Tenant & RBAC
- Jobs (public links + UTM)
- Flow Builder
- Flow Runner
- ATS (kanban + candidate card)
- Scheduler
- Messaging
- Integrations (Google Sheets + Webhook outbox)
- Analytics
- Templates

## Non-functional baseline

- Mobile first UX
- FCP < 2.5s на 4G
- API p95 < 500ms на сохранение ответов
- Queue + retries + idempotency for submit/events
- Tenant isolation + RBAC + audit log
- Data retention default 365 days

## MVP scope (Sprint 1-2)

- Auth + tenant context
- Jobs + public page
- Flow Runner (intro/screening/form/consent/end)
- Application submit + scoring thresholds
- ATS list + candidate card (read only at first)
- Webhook outbox `application_submitted`

## Risks

- Сложные ветвления в Flow Runner
- Надежность outbox/retry
- Строгая изоляция tenant данных
- Дедупликация кандидатов (email/phone/telegram)
