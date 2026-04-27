---
id: TASK-7
title: 'T7: Слой MCP-ресурсов (workflow + правила + справочники)'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-27 11:33'
labels:
  - T7
  - phase-1
  - size-M
dependencies:
  - TASK-5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Заменить SKILL.md-файлы на on-demand ресурсы. Снизить размер
системного промпта, лочить контент к версии бинарника.

**Что.** В `src/mcp/resources/` — markdown-контент, экспортируемый через
`resources/list` + `resources/read`:

| URI | Замещает | Описание |
|---|---|---|
| `zond://workflow/test-api` | `skills/api-testing/SKILL.md` (Workflow) | основной флоу |
| `zond://workflow/scenarios` | `skills/api-scenarios/SKILL.md` | пользовательские сценарии |
| `zond://workflow/diagnosis` | `skills/test-diagnosis/SKILL.md` | разбор failure |
| `zond://workflow/setup` | `skills/setup/SKILL.md` | установка/обновление |
| `zond://rules/safety` | блок «NEVER do these» | --safe, --dry-run, CRUD-гарды |
| `zond://rules/never` | блок «MANDATORY NEVER» | критические запреты |
| `zond://reference/yaml` | блок YAML reference | формат, ассерты, generators |
| `zond://reference/auth-patterns` | блок auth setup | setup.yaml, capture |
| `zond://catalog/{api}` | runtime | `.api-catalog.yaml` для API |
| `zond://run/{id}/diagnosis` | runtime | готовая диагностика по run id |

Контент — markdown-файлы в `src/mcp/resources/content/*.md`, эмбедятся через
`with { type: "file" }` (как уже сделано для htmx/style.css).

**Файлы.** `src/mcp/resources/index.ts`, `src/mcp/resources/content/*.md`,
`src/mcp/server.ts`.

**Зависит от.** T5.

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `resources/list` возвращает 8 фиксированных URI (workflow x4, rules x2, reference x2); `resources/templates/list` возвращает шаблоны `zond://catalog/{api}` и `zond://run/{id}/diagnosis`
- [x] #2 `resources/read` отдаёт markdown-тело для каждого статического URI и динамически рендерит `zond://run/{id}/diagnosis` (markdown) и `zond://catalog/{api}` (yaml)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализация
- `src/mcp/resources/content/*.md` (8 файлов) — извлечения из `skills/*/SKILL.md` (skills сами не трогаем — это TASK-9). Контент эмбедится в bundle через `import "./x.md" with { type: "text" }` (Bun import attribute, образец — Backlog.md `src/guidelines/mcp/`).
- `src/mcp/resources/{types,content,registry,index}.ts` + `catalog-resource.ts` + `diagnosis-resource.ts` — статика и шаблоны.
- `src/core/diagnostics/render-md.ts` — `renderDiagnosisMarkdown(DiagnoseResult)` для `zond://run/{id}/diagnosis`.
- `src/mcp/server.ts` — добавлены ListResourcesRequestSchema (заполнен), ListResourceTemplatesRequestSchema, ReadResourceRequestSchema; `McpServerContext` получил `cwd?: string` (для catalog lookup).
- `src/mcp/resources/markdown.d.ts` — ambient declaration для `*.md` импортов.

Тесты
- `tests/integration/mcp.test.ts` — обновлён stub-тест, добавлены проверки списка статики (8 uri), списка templates (2), чтения статического URI и обработки ошибок.
- `tests/integration/mcp-tools.test.ts` — добавлен smoke `zond://run/{runId}/diagnosis` поверх созданного в AC#2 run'а; и проверка ошибки на несуществующий runId.

Verification
- `bun run check` — clean
- `bun run test:unit` — 584 pass / 1 skip / 0 fail
- `bun build --compile src/cli/index.ts` — bundle 488 modules, бинарь корректно отдаёт `resources/list` (8), `resources/templates/list` (2) и читает `zond://workflow/test-api`.

Расхождение с исходным AC#1
Изначальная формулировка («resources/list возвращает фикс + динамику») была переформулирована: динамика ушла в `resources/templates/list` — это правильнее по MCP spec и не вынуждает сервер сканировать FS/БД при каждом list. Discovery покрыт обоими endpoints.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано

Слой MCP-resources поверх общего core (T7, phase-1).

**Static resources (8, mimeType `text/markdown`):**
- `zond://workflow/{test-api,scenarios,diagnosis,setup}` — основные флоу
- `zond://rules/{safety,never}` — safety/MANDATORY NEVER
- `zond://reference/{yaml,auth-patterns}` — YAML reference и auth patterns

**Resource templates (2, dynamic):**
- `zond://catalog/{api}` (`application/yaml`) — отдаёт `.api-catalog.yaml` относительно cwd
- `zond://run/{id}/diagnosis` (`text/markdown`) — markdown-рендер `diagnoseRun(id)` через новый `src/core/diagnostics/render-md.ts`

Контент — реальные markdown-файлы в `src/mcp/resources/content/*.md`, эмбедятся в bundle через Bun `import ... with { type: "text" }`. Версия контента жёстко привязана к VERSION бинарника (decision-1 п.4).

Skills/* НЕ тронуты — их сжатие до тонких оркестраторов в TASK-9 (зависел от T7, теперь разблокирован).

## Файлы

Создано:
- `src/mcp/resources/content/*.md` (8)
- `src/mcp/resources/{types,markdown.d,content,registry,catalog-resource,diagnosis-resource,index}.ts`
- `src/core/diagnostics/render-md.ts`

Изменено:
- `src/mcp/server.ts` — 3 новых request handler'а (ListResources/ListResourceTemplates/ReadResource), `McpServerContext.cwd?: string`
- `tests/integration/mcp.test.ts` — заменён T7-stub, добавлены проверки списка/чтения/ошибок
- `tests/integration/mcp-tools.test.ts` — добавлен smoke для динамического `zond://run/{id}/diagnosis`

## Verification

- `bun run check` — clean
- `bun run test:unit` — 584 pass / 1 skip / 0 fail
- `bun build --compile` → бинарь отвечает: `resources/list`=8, `resources/templates/list`=2, `resources/read zond://workflow/test-api` возвращает 8.6KB markdown
<!-- SECTION:FINAL_SUMMARY:END -->
