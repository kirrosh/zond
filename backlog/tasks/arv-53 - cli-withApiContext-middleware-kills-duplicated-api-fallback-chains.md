---
id: ARV-53
title: 'cli: withApiContext middleware kills duplicated --api fallback chains'
status: Done
assignee: []
created_date: '2026-05-10 18:44'
updated_date: '2026-05-10 19:05'
labels:
  - m-17
  - cli
  - refactor
  - agent-contract
milestone: m-17
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Накопленный долг: --api fallback повторяется 5 раз — TASK-17 (checks run), TASK-20 (prepare-fixtures), ARV-21 (coverage), ARV-29 (audit), ARV-33 (probe mass-assignment). Каждый раз отдельный коммит с одинаковым кодом 'apiArg ?? ZOND_API ?? currentApi()'. После 6-го повторения паттерн должен стать middleware. Пока не сделано — каждая новая команда добавляет шестое такое исправление в feedback-loop'е.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Helper withApiContext(handler) в src/cli/util/api-context.ts: parses --api из argv, fallback ZOND_API → .zond/current-api → null|throw
- [x] #2 Все commands which нужен resolved API wrapped в withApiContext (run, checks, generate, probe, prepare-fixtures, audit, coverage, db, doctor, request)
- [x] #3 grep -rn 'ZOND_API ?? currentApi\|ZOND_API_GLOBAL ?? ' src/cli/commands/ возвращает 0 строк (всё съедено middleware)
- [x] #4 Existing tests все green; добавлен unit-test tests/cli/util/api-context.test.ts с 6 cases (CLI flag, env, current-api file, missing, conflict)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/cli/util/api-context.ts экспортирует withApiContext<T>(handler: (api: ResolvedApi, ...rest) => T): (...) => T.\n2. Decorator парсит CLI --api, читает ZOND_API, потом findCurrentApi(); кладёт в ctx.\n3. Отдельный mode 'api-optional' (для команд типа zond list которые не требуют api) — wrap, но не throw на missing.\n4. Удалить дубликаты резолвера из 10+ мест — по списку из git log message TASK-17/20, ARV-21/29/33.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-05-10 — closed by ARV-53 (m-17 block C, foundation)

- New `src/cli/util/api-context.ts` owns the single `--api` resolution chain (local opt → ancestor opt → ZOND_API_GLOBAL → ZOND_API → .zond/current-api).
- Replaced inline duplicates in: prepare-fixtures, audit, checks, coverage, run, request, probe (resolveProbeApi now thin-wraps `getApi`).
- `grep -rn 'opts\.api ?? .*parent?\.opts\|ZOND_API_GLOBAL ?? ' src/cli/commands/` → 0 lines.
- Unit suite: `tests/cli/util/api-context.test.ts` (8 cases) + existing `tests/cli/probe-api-fallback.test.ts` still green.
- `bun run check` clean.
<!-- SECTION:NOTES:END -->
