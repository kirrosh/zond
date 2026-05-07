---
id: TASK-195
title: >-
  tests: drop redundant CLI smoke spawns (cli-smoke, internal-error,
  completions)
status: To Do
assignee: []
created_date: '2026-05-07 10:10'
labels:
  - refactor
  - tests
  - cli
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tests/cli/cli-smoke.test.ts: 4 spawn'а — все ассерты (--help, --version, unknown command, ui alias) дублируют tests/cli/program.test.ts (L88-93, L95-106, L284-288, L290-294). tests/cli/internal-error.test.ts: 30 строк, 2 spawn'а, оба дублируют program.test.ts (unique только not.toContain('[zond:internal]')). tests/cli/completions.test.ts L58-98: 5 spawn'ов дублируют unit-кейсы L27-56 байт-в-байт. Снести redundancy, перенести unique assertions in-process через program.parseAsync + capture stderr.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/cli/cli-smoke.test.ts удалён (или сокращён до ≤1 spawn для --version + runtime tag через ZOND_E2E env-gate)
- [ ] #2 tests/cli/internal-error.test.ts удалён; '[zond:internal]' assertion добавлен в program.test.ts
- [ ] #3 tests/cli/completions.test.ts L58-98 удалены; 'unsupported shell' и 'missing shell arg' переведены на tryParse-стиль
- [ ] #4 Удалено ≥10 spawn-кейсов; bun test зелёное; общее число тестов уменьшено только за счёт удалённых дублей
<!-- AC:END -->
