---
id: TASK-147
title: 'skill: env_issue early-stop когда CRUD весь упал на permission'
status: Done
assignee: []
updated_date: '2026-05-07'
labels:
  - skill
  - docs
milestone: m-8
dependencies: []
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback §4 раунд 2 (skill)](../notes/m-8-audit-cli-gaps/feedback-original.md).

В Sentry-аудите CRUD-run #9 не дошёл ни до одного 200 — все шаги
свалились на 403 SCIM (Enterprise-only). Скилл говорит «`--validate-schema`
обязателен для CRUD», но не говорит, что делать, если **все** ответы —
permission/scope errors. Я чуть не сгенерировал case-studies на это, что
бессмысленно.

## Что сделать

В скилле (`src/cli/commands/init/templates/skills/zond.md` или эквивалентный
файл) добавить iron rule / pattern:

> **Если все CRUD-шаги упали на 401/403 / `permission_denied` / scope-error
> — это `env_issue`, не баг.** Не генерировать case-studies, не править
> expects. Действие: `zond db diagnose <run-id> --env-only`, прочитать,
> проверить `auth_token` scope, при необходимости попросить у владельца
> API более широкий токен или пометить suite SKIPPED. Идти дальше по
> другим suites.

Также:
- Дать пример вывода `zond db diagnose --env-only`.
- Сослаться на `zond doctor --missing-only` (TASK-145) для проверки
  предусловий.

## Acceptance Criteria

- [ ] В skill добавлена iron rule про env_issue early-stop.
- [ ] Описан конкретный сигнал (≥80% CRUD-шагов с 401/403).
- [ ] Перечислены действия и НЕ-действия (без case-study, без правки
      expects).
- [ ] Пример вывода `diagnose --env-only`.
- [ ] Скилл прошёл review (можно через `bun run check`/lint, если есть).
