---
id: m-11
title: "repo-hygiene-and-refactor"
---

## Description

Технический долг и шум в репо после m-6..m-10. К моменту закрытия
m-10 surface вырос до 28 CLI-команд и ~24k строк TS, накопились
дубликаты документации, knip-долги, обрубки MCP, runtime-артефакты в
корне и 4 параллельных probe-команды с пересекающимся кодом.
Майлстоун **только про чистку и рефакторинг** — без новых пользова-
тельских фич.

## Цели майлстоуна

### A. Clean-up (низкий риск)

1. Удалить `CLAUDE.md` (тривиальный wrapper над AGENTS.md, который и
   так — SOT).
2. Удалить `.mcp.example.json` (реликт MCP, decision-2).
3. Не хранить бинарь `zond` и `zond.db*` в корне репо: бинарь —
   только в `dist/`, БД — в `.zond/`.
4. Закрыть knip-долги: `src/core/diagnostics/render-md.ts`,
   `src/core/parser/index.ts`, `src/core/runner/index.ts`, фантомный
   `tailwindcss` в `dependencies`, ~28 unused exports.
5. Свернуть `docs/INDEX.md` и `docs/project-backlog.md` (дублируют
   README + AGENTS.md).
6. Синхронизировать `install.ps1` ↔ `install.sh` (расходятся с апреля).

### B. CLI surface diet

7. `zond probe <class>` как зонтик для `probe-validation`,
   `probe-methods`, `probe-mass-assignment`, `probe-security` с
   back-compat алиасами на 1 релиз.
8. Слить `src/cli/commands/init/` и `src/cli/commands/init.ts` —
   двойная точка входа путает.
9. Зафиксировать политику `--json` envelope (TASK-73, TASK-74) одним
   модулем, без правок 28 команд.

### C. Core extraction

10. `src/core/probe/runner.ts` — общий probe-runner: HTTP, capture,
    redaction, reporter (сейчас 70% кода размазано по 4 командам).
11. `src/core/exporter/` за единым интерфейсом `Exporter` с явным
    `applySanitizer()` шагом (m-10 ввёл sanitizer руками в каждом).
12. Порезать `src/db/queries.ts` по доменам:
    `runs.ts`, `sessions.ts`, `coverage.ts`.

## Не покрывает

- Новые пользовательские фичи и probe-классы (m-5).
- UI/serve полировка (m-7).
- Качество генератора и probe-recall (m-1, m-8).

## Принципы

- Каждая задача — отдельный коммит `TASK-<N>: <subject>`.
- Back-compat: на удаления CLI-флагов/команд — deprecation warning на
  один релиз, breaking-change-запись в `CHANGELOG.md`.
- Любая удаляемая публичная вещь (команда, экспорт, документ) —
  сначала grep по репо и `skills/` на упоминания.
