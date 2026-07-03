---
id: ARV-298
title: >-
  docs: CLAUDE.md in src/ — architecture map + data-flow
  Setup→Generate→Run→Analyze→Report
status: Done
assignee: []
created_date: '2026-05-18 12:56'
updated_date: '2026-05-18 13:04'
labels:
  - docs
  - hygiene
  - validation-sprint
  - m-23
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
В src/ нет архитектурной документации. Новому разработчику (или агенту) приходится восстанавливать слои и data-flow из кода. AGENTS.md есть, но он про workspace-контракт (.api-fixtures.yaml vs .env.yaml), а не про структуру кода. Cost: 0.5 дня. Risk: zero. Выявлено в pre-release refactor review 2026-05-18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/CLAUDE.md описывает верхнеуровневые слои: cli/, core/, db/
- [x] #2 Документирован data-flow по фазам: Setup → Generate → Run → Analyze → Report
- [x] #3 Указаны точки расширения (probe class, check, reporter format) с конкретными директориями
- [x] #4 Описан контракт между .api-fixtures.yaml (manifest) и .env.yaml (values) с ссылкой на AGENTS.md
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Создан src/CLAUDE.md: top-level layout (cli/core/db), подсистемы core/ с ролями, 5-фазный data-flow (Setup→Generate→Run→Analyze→Report), extension points (probe/check/reporter/anti-fp/db), ссылка на workspace contract в AGENTS.md, conventions. tsc --noEmit проходит.
<!-- SECTION:FINAL_SUMMARY:END -->
