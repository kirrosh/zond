---
id: TASK-13
title: 'T13: Definition of Done для тестов (project-level ассерты)'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T13
  - phase-3
  - size-M
dependencies:
  - TASK-12
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Аналог backlog DoD-defaults. «Любой ответ должен быть JSON и быстрее
1с» — повторяется в каждом suite, шумит. Лучше декларировать раз.

**Что.** В `zond.config.yml` секция `dod:` (см. T12). При запуске suite —
автоматически инжектится в каждый `expect:` block. Override на уровне теста:
`dod: false` или `dod: { skip: [response_time_ms] }`.

**Файлы.** `src/core/runner/executor.ts`, `src/core/runner/assertions.ts`,
`src/core/parser/schema.ts`.

**Зависит от.** T12.

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Тесты `tests/runner/dod.test.ts` показывают, что DoD-ассерты применяются ко всем тестам, кроме отмеченных `dod: false`
<!-- AC:END -->
