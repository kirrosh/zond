---
id: TASK-30
title: 'T30: Документация — уточнить роль MCP vs CLI vs Skills (направление B)'
status: To Do
assignee: []
created_date: '2026-04-27 13:42'
labels:
  - docs
  - mcp
milestone: m-2
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Live-сессия против Resend прошла полностью через CLI + skill `zond:test-api`. MCP-tools (T6) не вызывались — `.mcp.json` либо не был approved для проекта, либо skill не упоминает MCP-инструменты. CLI отдаёт компактные структурированные summary, MCP-tools 1:1 дублируют CLI и в этом флоу избыточны.

**Направление B**: сократить будущие MCP-tools до тех, что не имеют CLI-эквивалента (structured JSON для diagnose/compare/coverage). Resources (workflow/правила) остаются.

⚠️ Код MCP пока **не трогаем** — нужна ещё одна live-сессия с включённым MCP, чтобы убедиться, что вывод не зависит от того, что агент мог собрать контекст из локальной папки исходников.

## Что сделать (только docs)

- **AGENTS.md / CLAUDE.md**: явно указать, что предпочтительный путь — CLI + skills; MCP — опциональный путь для клиентов без shell.
- **ZOND.md**: раздел "MCP vs CLI" — когда что использовать, что обещаем (resources всегда, tools только для structured-JSON задач).
- **README.md**: проверить, что не продаёт MCP как обязательный.
- **skills/zond:test-api/SKILL.md**: убедиться, что skill ведёт через CLI, MCP упомянут как fallback.

## Acceptance

- В AGENTS.md/CLAUDE.md/ZOND.md есть согласованный нарратив про роли.
- Не предпринимается удаление MCP-tools кода (это T31+ после следующей сессии).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AGENTS.md обновлён
- [ ] #2 CLAUDE.md обновлён
- [ ] #3 ZOND.md содержит раздел MCP vs CLI
- [ ] #4 skill SKILL.md проверен
- [ ] #5 Код MCP не тронут
<!-- AC:END -->
