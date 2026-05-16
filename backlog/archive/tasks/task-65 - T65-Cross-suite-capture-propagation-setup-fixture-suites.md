---
id: TASK-65
title: 'T65: Cross-suite capture propagation (setup/fixture suites)'
status: To Do
assignee: []
created_date: '2026-04-29 08:35'
updated_date: '2026-04-29 08:42'
labels:
  - runner
  - ergonomics
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас «Each suite runs in its own variable scope. Captured variables do not propagate between suites» (ZOND.md). На live-сессии Resend это вылезло: для CRUD-сьютов нужен existing audience_id / domain_id, и приходится либо хардкодить в .env.yaml, либо дублировать setup внутри каждого сьюта.

Удобнее — пометить сьют как setup/fixture: его captures доступны другим сьютам по имени.

## Что сделать

1. Тег / атрибут на уровне сьюта: `scope: shared` (или `fixture: true`). Captures такого сьюта пушатся в общий run-scope.
2. Порядок исполнения: fixture-сьюты сначала, остальные после.
3. Failure semantics: если fixture упал — dependent сьюты skip cascade.
4. Опционально: `depends_on: [setup-audiences]` на уровне сьюта для явной топологии.
5. Документация в ZOND.md (раздел Suite Variable Isolation): описать когда использовать shared vs хардкод в env.

## Acceptance

- Setup-сьют создаёт audience, captures audience_id, CRUD-сьют его использует без дубликата setup-step'а.
- Failure setup-сьюта корректно cascade'ит на dependent.
- Backwards-compatible: сьюты без `scope: shared` ведут себя как раньше.
- Документация.

## Milestone

m-1 (test-generation-quality) — не bug-hunting, runner ergonomics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Race-safe: при parallel-режиме fixture-сьюты ждут завершения перед запуском dependent suites; capture race на shared scope невозможен
<!-- AC:END -->
