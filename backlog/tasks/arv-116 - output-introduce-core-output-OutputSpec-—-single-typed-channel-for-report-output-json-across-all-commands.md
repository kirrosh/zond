---
id: ARV-116
title: >-
  output: introduce core/output OutputSpec — single typed channel for
  --report/--output/--json across all commands
status: To Do
assignee: []
created_date: '2026-05-11 10:12'
labels:
  - m-19
  - refactor
  - blocker-m-18
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lesson §E (strategy/lessons.md): 7 багов о `--report`/`--output`/`--json` расхождениях. Каждая команда сейчас имеет свой парсер. Цель — типизированная таблица (command, format) → (where, schema, exit-code-policy) в одном модуле.

Создать src/core/output/:
- OutputSpec<Payload> interface с formats / defaultFormat / defaultChannel / defaultFilename / envelopeWrap / exitCodePolicy.
- runCommandWithOutput() helper: парсит --report, --output, --json по OutputSpec.
- Тесты на: SARIF default → file, NDJSON default → stdout, --output overrides channel, --json + --report mutual exclusion.

Этот task — только infrastructure. Миграция команд run/checks/probe — отдельные задачи.

Ломать совместимость разрешено: никаких alias'ов под старые опции.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 core/output/types.ts с OutputSpec interface
- [ ] #2 core/output/run.ts с runCommandWithOutput() helper
- [ ] #3 tests/core/output/*.test.ts покрывает 6 правил matrix'а (format × channel × envelope-wrap)
- [ ] #4 Документация в src/core/output/README.md — таблица всех допустимых (format, channel, envelopeWrap) комбинаций
<!-- AC:END -->
