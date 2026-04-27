---
id: TASK-22
title: 'T22: zond status команда + SQLITE_BUSY retry'
status: To Do
assignee: []
created_date: '2026-04-27 12:39'
labels:
  - T22
  - phase-4
  - size-S
  - priority-p2
  - workspace
  - diagnostics
milestone: m-0
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Discoverability — пользователь / агент должны быстро понять «где БД, какой текущий API, какие env-файлы видит zond». Сейчас этого нет. Плюс: при двух параллельных `zond run` на одну БД (`src/db/schema.ts:23` WAL mode) возможен SQLITE_BUSY, не обрабатывается — зонд может вылететь.

**Что.**
1. **`zond status`** (или `zond doctor`) — печатает: workspace root (или «not found»), DB path + size, current API из `.zond-current` (T15), `.env.yaml` files visible, suite count, MCP server reachable yes/no.
   - С `--json` envelope.
2. **SQLITE_BUSY retry** — обернуть write-операции в `src/db/queries.ts` exponential backoff (3-5 попыток, начинать с 50ms). Не bombard'ить — это деградация UX, но лучше падения.

**Файлы.** `src/cli/commands/status.ts` (новый), `src/cli/program.ts`, `src/db/queries.ts` (retry helper).

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `zond status` печатает workspace root (или 'not found'), DB path, current API, count of suites, MCP sanity
- [ ] #2 `zond status --json` возвращает структурированные данные в стандартном envelope
- [ ] #3 Параллельный `zond run` x2 на одну БД больше не падает с SQLITE_BUSY (тест: spawn двух процессов одновременно)
<!-- AC:END -->
