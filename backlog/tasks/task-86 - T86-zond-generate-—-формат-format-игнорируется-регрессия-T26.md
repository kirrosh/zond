---
id: TASK-86
title: 'T86: zond generate — формат format: игнорируется (регрессия T26)'
status: To Do
assignee: []
created_date: '2026-04-29 08:42'
labels:
  - bug
  - generator
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Top-5 ROI fix. TASK-26 (Done) маппит format → generators. Round 2: пользователь сообщает что generator всё ещё подставляет $randomString для format: email на /emails.

Возможны два сценария:
1. T26 не покрыл path generator (только probe-validation fixtures).
2. Регрессия после T26.

## Что сделать

1. Проверить путь zond generate → выбор fixture для каждого поля.
2. Убедиться что format: email/uri/uuid/etc обрабатываются.
3. Регрессионный тест на spec с разными format'ами.
4. Если T26 покрыл это — закрыть как not-a-bug с пояснением.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Generator подставляет $randomEmail для format: email (а не $randomString)
- [ ] #2 Покрытие: email, uri, uuid, hostname, ipv4, date, date-time как в TASK-26 (Done)
- [ ] #3 Тест регрессии: generate на spec с format: email → YAML содержит $randomEmail
<!-- AC:END -->
