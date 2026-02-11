# MVP Roadmap

## Phase 0: Foundation

- [x] Monorepo bootstrap
- [x] Infrastructure skeleton (Postgres, Redis)
- [x] Initial DB schema SQL
- [ ] CI (lint/test/build)

## Phase 1: Core API

- [ ] Auth (email/password + provider hooks)
- [ ] Tenant middleware + RBAC policy checks
- [ ] Jobs CRUD + activation + public_slug
- [ ] Candidate intake draft application

## Phase 2: Flow Runner

- [ ] Node rendering contract (intro/screening/test/form/upload/consent/end)
- [ ] Auto-save endpoints
- [ ] Branching resolver by edge priority/condition
- [ ] Submit validator + threshold status assignment

## Phase 3: ATS + Integrations

- [ ] ATS board/list filters
- [ ] Candidate card timeline
- [ ] Webhook outbox + HMAC signature + retries
- [ ] Google Sheets sink

## Phase 4: Product hardening

- [ ] Audit trail and retention jobs
- [ ] Metrics and funnel analytics
- [ ] Template library (10+)
- [ ] Load and performance testing
