---
id: TASK-146
title: probe-mass-assignment --emit-template <endpoint>
status: Done
assignee: []
created_date: ''
updated_date: '2026-05-08 15:57'
labels:
  - probe
  - probe-mass-assignment
  - emit-tests
milestone: m-8
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-8 feedback §1 раунд 2 (skill)](../notes/m-8-audit-cli-gaps/feedback-original.md).

Phase 5.1 скилла даёт текстовый шаблон для ручного MA-катчапа на
endpoint. В Sentry это значило копипастить YAML с расставленными
captures и cleanup'ами. Шаблон большой, бойлерплейт повторяется.

## Что сделать

`zond probe-mass-assignment --emit-template <method> <path> [--api <name>] [--output <file>]`

1. Сгенерировать готовый YAML-шаблон для конкретного endpoint'а:
   - List/Create/Update/Delete chain (если применимо), с captures на
     возвращённый id.
   - Test-case для mass-assignment: подмена protected-полей (роли,
     owner, is_admin, etc.) с assertion'ом «not equal».
   - Cleanup-секция с `always: true`.
2. Если spec содержит подсказки о protected-полях (`readOnly: true`,
   `x-zond-protected`) — использовать их; иначе — эвристика по именам
   (`role`, `owner_id`, `is_admin`, `permissions`).
3. По умолчанию вывод в stdout, `--output <file>` — в файл.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда генерирует валидный YAML, проходящий `zond run --check`.
- [ ] #2 Захватываемые captures корректно резолвят id из create-step'а.
- [ ] #3 Cleanup-step с `always: true` восстанавливает / удаляет ресурс.
- [ ] #4 Использование `readOnly` из spec покрыто тестом.
- [ ] #5 Скилл Phase 5.1 ссылается на команду вместо markdown-шаблона.
- [ ] #6 CHANGELOG.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
--emit-template <method:path> в probe mass-assignment. Full chain (create→verify→cleanup) при наличии read+delete sibling, иначе single-step. Inject SUSPECTED_FIELDS + readOnly/x-zond-protected. Серriализер исправлен: not_equals: true теперь boolean, не string. 5 unit-тестов. Скилл Phase 5.1 ссылается на команду.
<!-- SECTION:NOTES:END -->
