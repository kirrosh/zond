---
id: TASK-21
title: 'T21: .env.yaml walk-up до workspace root'
status: To Do
assignee: []
created_date: '2026-04-27 12:39'
labels:
  - T21
  - phase-4
  - size-XS
  - priority-p2
  - workspace
milestone: m-0
dependencies:
  - TASK-17
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** `loadEnvironment()` (`src/core/parser/variables.ts:150-158`) ищет только в `searchDir` и `dirname(searchDir)` — два уровня. Если тест в `apis/myapi/tests/` и общий `.env.yaml` лежит на уровне workspace root — он не найдётся.

**Что.** Расширить walk-up до workspace root (см. T17). Порядок precedence: tests-dir env > api-dir env > workspace-root env > defaults. Не выходить за пределы workspace root (избежать чтения `~/.env.yaml` пользователя!).

**Файлы.** `src/core/parser/variables.ts`.

**Зависит от.** T17.

**Размер.** XS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `.env.yaml` в workspace root подхватывается тестом из `<root>/zond/apis/<name>/tests/foo.yaml`
- [ ] #2 Поиск НЕ выходит выше workspace root (тест с `~/.env.yaml` это подтверждает)
- [ ] #3 Existing precedence (tests-dir > api-dir) сохраняется, root добавляется как третий уровень
<!-- AC:END -->
