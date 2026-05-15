---
id: ARV-255
title: 'pivot: spec-lint mass downgrade + separate ''zond lint'' mode'
status: To Do
assignee: []
created_date: '2026-05-15 07:04'
labels:
  - m-21
  - pivot
  - spec-lint
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

854 spec-lint issues включая 132 HIGH (additionalProperties отсутствует и т.п.) — это и есть "волк! волк!" в отчёте. После такого отчёта команда теряет доверие к инструменту.

## Цель

Spec-lint — отдельный workflow для maintainer\u0027ов спеки. Полезен, но не должен инфлировать severity в security/audit отчёте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все spec-lint findings (additionalProperties: false missing, examples missing, descriptions missing, naming style, etc.) принудительно LOW/INFO. Никаких HIGH на статике YAML.
- [ ] #2 Создан отдельный режим 'zond lint' (или 'zond check spec --lint') который выпускает spec-lint findings в свою категорию hygiene.
- [ ] #3 Основной 'zond audit' / 'zond probe' / 'zond checks run' отчёт spec-lint findings НЕ показывает по умолчанию (только под --include-hygiene или явный --lint флаг).
- [ ] #4 На GitHub spec (текущие 854 issues / 132 HIGH) после изменения: 0 HIGH в основном отчёте; вся spec-lint hygiene доступна через 'zond lint' отдельно.
- [ ] #5 Skill zond-checks.md обновлён: spec-lint описан как отдельный workflow, не часть security audit.
<!-- AC:END -->
