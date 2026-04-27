# CLAUDE.md

Claude Code, читай [AGENTS.md](AGENTS.md) — там инструкции по работе с этим
репозиторием, включая управление задачами через Backlog.md.

Кратко:

- Задачи проекта — в `backlog/`, управляются через MCP-сервер `backlog`
  (см. `.mcp.json`). Полный workflow — в ресурсе `backlog://workflow/overview`.
- При запросе «возьми задачу» — список через `backlog.task_list`,
  смена статуса через `backlog.task_edit`. Коммиты делаем сами, `auto_commit`
  выключен.
- Полный CLI-референс zond — `ZOND.md`. README — для пользователей.
