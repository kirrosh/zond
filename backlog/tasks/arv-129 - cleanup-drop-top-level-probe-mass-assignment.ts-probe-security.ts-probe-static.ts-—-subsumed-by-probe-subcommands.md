---
id: ARV-129
title: >-
  cleanup: drop top-level probe-mass-assignment.ts / probe-security.ts /
  probe-static.ts — subsumed by probe subcommands
status: To Do
assignee: []
created_date: '2026-05-11 10:14'
labels:
  - m-19
  - cleanup
  - breaking-change
dependencies:
  - ARV-119
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§5/G refactor-plan. Top-level commands/probe-*.ts существуют рядом с подкомандами probe.ts. После ARV-119 (миграция probe family на OutputSpec) — drop'нуть top-level дубликаты.

Удалить:
- src/cli/commands/probe-mass-assignment.ts
- src/cli/commands/probe-security.ts
- src/cli/commands/probe-static.ts
- любые их регистрации в src/cli/program.ts

Совместимость не сохраняем (no alias). Skill'ы / docs обновить — отдельные правки в самих файлах (или поймает ARV-121 regression test).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 три файла удалены
- [ ] #2 ls src/cli/commands/probe-*.ts → нет результатов
- [ ] #3 program.ts не регистрирует удалённые команды
- [ ] #4 init/templates/skills/*.md не ссылается на старые формы команд
<!-- AC:END -->
