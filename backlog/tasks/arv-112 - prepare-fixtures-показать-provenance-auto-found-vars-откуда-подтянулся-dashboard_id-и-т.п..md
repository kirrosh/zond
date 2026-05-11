---
id: ARV-112
title: >-
  prepare-fixtures: показать provenance auto-found vars (откуда подтянулся
  dashboard_id и т.п.)
status: Done
assignee: []
created_date: '2026-05-11 09:20'
updated_date: '2026-05-11 09:31'
labels:
  - zond
  - cli
  - fixtures
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После `prepare-fixtures --apply` некоторые vars подхватываются через cascade/auto-harvest (например, `dashboard_id` после fix'а ARV-69), но в stdout не видно, ОТКУДА именно — какой endpoint/list был источником.

Это создаёт две проблемы:
1. Если auto-found value неверный, агент не знает, какой list-эндпоинт перепроверить.
2. Невозможно в running session понять, какие vars подтянулись автоматически vs остались на cascade'е/чейнах.

Parity reference: `doctor --verify` уже показывает provenance — нужна та же информация в `prepare-fixtures` stdout (или `--explain` flag).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 stdout `prepare-fixtures --apply` показывает source endpoint для каждого auto-found var
- [x] #2 формат parity с `doctor --verify` (consistent labels)
- [ ] #3 опционально: `--explain` flag, если по умолчанию слишком verbose
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Добавлен sourceEndpoint в perTarget структуру bootstrap'а: 'GET /list' для discovered, 'POST /create' для seeded, '(pre-set)' для already. Stdout печатает 'from <endpoint>' суффикс. JSON envelope включает sourceEndpoint в perTarget[]. AC#3 (--explain flag) не реализован — sourceEndpoint фоном печатается всегда без verbosity (поведение consistent с другими полями таблицы). Если стоит проблема verbose-вывода — отдельный таск на --quiet/--explain режим.
<!-- SECTION:NOTES:END -->
