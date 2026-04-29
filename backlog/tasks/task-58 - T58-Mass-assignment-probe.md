---
id: TASK-58
title: 'T58: Mass-assignment probe'
status: To Do
assignee: []
created_date: '2026-04-29 08:34'
labels:
  - bug-hunting
  - security
milestone: m-4
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В round 2 live-сессии вручную проверены /topics и /contacts: extra fields (id, created_at, account_id, is_admin, is_system, verified, object) принимаются молча, но не используются — server-assigned поля не перезаписываются. На Resend класс закрыт; на других API yield высокий и это privilege-escalation риск (особенно PATCH).

## Что сделать

Команда `zond probe-mass-assignment <spec>` (или флаг к `zond probe-validation`):

Для каждого POST/PATCH endpoint:
1. Берём request schema, добавляем поля которых там нет: классические подозреваемые (`is_admin: true`, `verified: true`, `role: 'admin'`, `account_id: <random_uuid>`, `owner_id: <random>`, `is_system: true`).
2. Также добавляем поля из response-схемы которых нет в request-схеме (server-assigned поля типа `id`, `created_at`).
3. Шлём запрос. Классифицируем поведение:
   - **rejected (4xx)** — best (validates strict).
   - **accepted-and-applied** — поле в response отличается от server-default → potential privilege-escalation.
   - **accepted-and-ignored** — поле молча проглочено, но не применилось (как Resend). Soft-warn.
4. Output — markdown digest с группировкой по severity.

## Acceptance

- На spec с явным additionalProperties: false — все probes ожидают reject.
- Различает accepted-and-applied vs accepted-and-ignored через follow-up GET.
- Документация + примеры подозреваемых полей.
<!-- SECTION:DESCRIPTION:END -->
