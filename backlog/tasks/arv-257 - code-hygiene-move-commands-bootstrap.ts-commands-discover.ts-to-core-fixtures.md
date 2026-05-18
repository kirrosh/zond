---
id: ARV-257
title: >-
  code hygiene: move commands/bootstrap.ts + commands/discover.ts to
  core/fixtures/
status: To Do
assignee: []
created_date: '2026-05-16 07:28'
updated_date: '2026-05-18 13:02'
labels:
  - refactor
  - hygiene
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Оба файла лежат в src/cli/commands/, но не регистрируют CLI-команды (registerBootstrap/Discover не существует). Экспортируют функции для prepare-fixtures, fixtures, checks. Это мисплейс — должны быть в core/fixtures/ или похожем модуле. Cost: ~0.5 дня, низкий риск (typed imports). Выявлено в validation-спринте 2026-05-16.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Downgraded to LOW (2026-05-16 strategy review): low-risk refactor (0.5 day), no trigger event. Pick up in any momentum window — not blocking strategy or features.
<!-- SECTION:NOTES:END -->
