---
id: ARV-257
title: >-
  code hygiene: move commands/bootstrap.ts + commands/discover.ts to
  core/fixtures/
status: To Do
assignee: []
created_date: '2026-05-16 07:28'
labels:
  - refactor
  - hygiene
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Оба файла лежат в src/cli/commands/, но не регистрируют CLI-команды (registerBootstrap/Discover не существует). Экспортируют функции для prepare-fixtures, fixtures, checks. Это мисплейс — должны быть в core/fixtures/ или похожем модуле. Cost: ~0.5 дня, низкий риск (typed imports). Выявлено в validation-спринте 2026-05-16.
<!-- SECTION:DESCRIPTION:END -->
