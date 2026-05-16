---
id: TASK-76
title: 'T76: NUL-byte / control-char generator + safe YAML escape'
status: To Do
assignee: []
created_date: '2026-04-29 08:40'
labels:
  - bug-hunting
  - generator
  - bug
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

NUL-injection (`x@example.com\x00malicious`) — известный класс багов в email-парсерах. Запись в YAML литерального \u0000 ломает весь сьют (parse error без локации).

## Что сделать

1. Новые generator-helpers $nullByte / $ctrlChar — interpolate в request, не падают на YAML-парсе.
2. YAML parse error с NUL — explicit hint про generator.
3. Документация в ZOND.md (Generators table).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Generator {{$nullByte}} → \u0000 в interpolation
- [ ] #2 Generator {{$ctrlChar}} → набор control characters (ESC, BEL, NUL, BS)
- [ ] #3 YAML с raw NUL — понятная ошибка с file:line (см. T71)
- [ ] #4 Документация: используйте $nullByte вместо \u0000-литералов в YAML
<!-- AC:END -->
