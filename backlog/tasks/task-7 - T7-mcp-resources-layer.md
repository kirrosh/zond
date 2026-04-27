---
id: TASK-7
title: 'T7: Слой MCP-ресурсов (workflow + правила + справочники)'
status: To Do
assignee: []
created_date: '2026-04-27'
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
- [ ] #1 `resources/list` возвращает фиксированный набор + динамические `zond://catalog/{api}` и `zond://run/{id}/diagnosis`
- [ ] #2 `resources/read` отдаёт тело для каждого URI
<!-- AC:END -->
