---
id: TASK-183
title: 'refactor: merge src/cli/commands/init.ts and init/'
status: Done
assignee: []
created_date: '2026-05-07 06:49'
updated_date: '2026-05-07 07:12'
labels:
  - refactor
  - cli
milestone: m-11
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Два места одной команды: src/cli/commands/init.ts и src/cli/commands/init/{bootstrap,agents-md,skills,templates}. Двойная точка входа путает: непонятно какой файл регистрирует команду в program.ts, какой — реализация. Слить в один модуль (init/index.ts как entry, остальные подмодули рядом).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/cli/commands/init.ts удалён, его логика в src/cli/commands/init/index.ts
- [x] #2 program.ts импортирует ./commands/init
- [x] #3 tests/cli/init/* зелёные без правок поведения
<!-- AC:END -->
