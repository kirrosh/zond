---
id: ARV-121
title: >-
  contracts: skill regression tests — parse code-blocks from
  init/templates/skills/*.md and dry-run on synthetic spec
status: To Do
assignee: []
created_date: '2026-05-11 10:13'
labels:
  - m-19
  - contracts
  - blocker-m-18
  - anti-skill-drift
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§3 refactor-plan, lesson §C. 12 SD-finding'ов m-15..m-17 закрылись точечно (ARV-84..93). Структурной защиты от skill-drift нет.

tests/contracts/skill-examples.test.ts:
- enumerates src/cli/commands/init/templates/skills/*.md
- parses code-blocks помеченные lang `bash` или `shell`, содержащие `zond ...`
- skip-pragma: <!-- skip-regression --> до code-block'а
- для каждого: spawn(zond) против tests/fixtures/synthetic-spec/, проверяет exit != 64 (EUSAGE) и команда не падает с unknown option
- НЕ валидирует семантику — только что флаги существуют и форма команды парсится

Закрывает: SD4 (stale --env example), SD6 (--json collision), SD11 (stale --seed flag form), и не позволит SD13+ появиться в m-18 рецептах.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/contracts/skill-examples.test.ts существует
- [ ] #2 synthetic spec fixture в tests/fixtures/synthetic-spec/
- [ ] #3 тест зелёный на текущих skill'ах после ARV-84..93 фиксов
- [ ] #4 при добавлении заведомо broken примера (например zond run --json) тест падает
<!-- AC:END -->
