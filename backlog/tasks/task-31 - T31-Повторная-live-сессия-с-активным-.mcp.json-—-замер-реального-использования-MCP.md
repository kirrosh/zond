---
id: TASK-31
title: >-
  T31: Повторная live-сессия с активным .mcp.json — замер реального
  использования MCP
status: To Do
assignee: []
created_date: '2026-04-27 13:42'
labels:
  - mcp
  - research
milestone: m-2
dependencies:
  - TASK-30
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Перед удалением/сокращением MCP-tools нужно подтвердить, что агент их не использует **в условиях, где они реально доступны**. Прошлая сессия прошла без подключения `.mcp.json` zond — наблюдение неполное.

## Что сделать

1. Запустить `claude mcp add` для zond MCP в чистом workspace (без локальных исходников zond, чтобы исключить контекст из репо).
2. Дать агенту ту же задачу: «прогнать API-тесты для Resend / любого live-API».
3. Зафиксировать: какие MCP-tools/resources вызывались, какие — нет.
4. Сравнить с CLI-only сессией.

## Acceptance

- Отчёт в `docs/mcp-usage-survey.md` (или Confluence): какие MCP-tools оказались полезными, какие — мёртвый вес.
- На основе отчёта — отдельная задача T32 на сокращение MCP-tools (если подтверждается направление B).
<!-- SECTION:DESCRIPTION:END -->
