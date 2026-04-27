---
id: TASK-6
title: 'T6: Слой MCP-тулз поверх общего core'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-27 11:10'
labels:
  - T6
  - phase-1
  - size-L
dependencies:
  - TASK-5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Дать агенту типизированные тулзы вместо bash-обёрток. Тонкие, без
дублирования логики.

**Что.** В `src/mcp/tools/` — по файлу на тулзу. Каждая делегирует в
существующие `src/core/*` функции, как это делают `src/cli/commands/*.ts`.
Список:

| Тулза | Делегирует в | Возвращает |
|---|---|---|
| `zond_init` | `src/core/setup-api.ts` | collection record |
| `zond_describe` | `src/core/generator/describe.ts` | endpoint info |
| `zond_catalog` | `src/core/generator/catalog-builder.ts` | catalog yaml текстом |
| `zond_run` | `src/core/runner/execute-run.ts` | run id + summary |
| `zond_diagnose` | `src/core/diagnostics/db-analysis.ts` | structured diagnosis |
| `zond_request` | `src/core/runner/http-client.ts` | response body+meta |
| `zond_coverage` | `src/core/generator/coverage-scanner.ts` | coverage report |
| `zond_db_runs` | `src/db/queries.ts` | список runs |
| `zond_db_run` | `src/db/queries.ts` | детали run |
| `zond_validate` | `src/core/parser/*` | validation report |
| `zond_sync` | `src/core/sync/spec-differ.ts` | diff |

**Не делаем (важно):** `zond_create_test`, `zond_edit_yaml`, `zond_write_env` —
это работа Write.

Каждая тулза — JSON-schema для inputs (Zod), structured ответ.

**Файлы.** `src/mcp/tools/*.ts` (по файлу на тулзу),
`src/mcp/tools/index.ts`, `src/mcp/server.ts`.

**Зависит от.** T5.

**Размер.** L.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `tools/list` возвращает все тулзы со схемами
- [x] #2 `tools/call zond_run` исполняет тесты
- [x] #3 `tools/call zond_diagnose` отдаёт ту же структуру, что `zond db diagnose --json`
<!-- AC:END -->
