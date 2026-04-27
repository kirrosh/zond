---
id: TASK-55
title: 'T55: zond hunt — meta-команда: запустить все probe-классы'
status: To Do
assignee: []
created_date: '2026-04-27 16:43'
labels:
  - bug-hunting
  - ux
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После реализации T45-T54 у нас будет множество разрозненных probe-команд. Для пользователя нужен один entry point: «запусти всё что найдёт баги».

## Что сделать

Команда `zond hunt <spec>`:

1. Запускает по очереди:
   - `zond lint-spec` (T46)
   - `zond probe-validation` (T49)
   - `zond probe-methods` (T48)
   - `zond probe-deletion` (T53)
   - `zond fuzz` (T45) — если флаг `--fuzz`
   - `zond probe-idempotency` (T50) — если флаг `--idempotency`
   - `zond probe-concurrency` (T54) — если флаг `--concurrency`
2. Аккумулирует все находки в `bugs/digest-<timestamp>.md`:
   - Spec lint findings
   - Validation 5xx
   - 405 misses
   - Deletion semantics issues
   - Fuzz minimal repros
   - Idempotency issues
3. Финальный summary с severity classification.

Использование:
```bash
zond hunt openapi.json --output bugs/
zond hunt openapi.json --fuzz --idempotency --concurrency  # full sweep
```

## Acceptance

- На Resend OpenAPI находит все 6 багов из live-сессии.
- Markdown digest читаемый.
- Документация в ZOND.md как top-level workflow.

## Зависимость

Все T45-T54.
<!-- SECTION:DESCRIPTION:END -->
