---
id: TASK-182
title: 'refactor: zond probe <class> umbrella command'
status: Done
assignee: []
created_date: '2026-05-07 06:48'
updated_date: '2026-05-07 07:10'
labels:
  - refactor
  - cli
milestone: m-11
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас 4 параллельных топ-левел: probe-validation, probe-methods, probe-mass-assignment, probe-security. Раздувают --help, делают помощь шумной для новичка. Объединить под 'zond probe <class> [opts]' где class ∈ {validation, methods, mass-assignment, security}. Старые имена оставить как алиасы с deprecation warning'ом на 1 релиз.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond probe --help перечисляет доступные классы
- [x] #2 zond probe validation/methods/mass-assignment/security работают с теми же флагами, что у текущих команд
- [x] #3 Старые probe-* команды живы как алиасы и пишут 'deprecated, use zond probe <class>' в stderr
- [x] #4 skills/zond.md и AGENTS.md обновлены на новый синтаксис
- [x] #5 CHANGELOG.md: deprecation entry
- [x] #6 tests/cli — покрытие нового маршрута и алиасов
<!-- AC:END -->
