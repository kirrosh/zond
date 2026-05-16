---
id: TASK-196
title: 'tests: convert doctor.test.ts to in-process doctorCommand calls'
status: Done
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
tests/cli/doctor.test.ts: 8 runCli spawn'ов × ~500ms = ~4s overhead. Все вызовы конвертируются в прямой doctorCommand({...}) с suppressOutput, как в catalog.test.ts. Также: L85-87 throw new Error → expect().toBe(1); закрытый closeDb discipline в afterEach.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все 8 runCli заменены на доуenчные вызовы doctorCommand
- [x] #2 L85-87 throw new Error заменено на bun-test expect
- [x] #3 closeDb() вызывается в afterEach (не вручную в каждом тесте)
- [x] #4 Время прогона tests/cli/doctor.test.ts падает >50%
- [x] #5 Зелёное
<!-- AC:END -->
