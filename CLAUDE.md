# CLAUDE.md

Claude Code, читай [AGENTS.md](AGENTS.md) — там инструкции по работе с этим
репозиторием, включая управление задачами через Backlog.md.

Кратко:

- Задачи проекта — в `backlog/`, управляются через CLI Backlog.md
  (`bunx backlog task list --plain`, `bunx backlog task <id> --plain`).
- При запросе «возьми задачу» — список через `bunx backlog task list --plain --status "To Do"`,
  смена статуса через `bunx backlog task edit <id> -s "In Progress" --plain`.
  Коммиты делаем сами, `auto_commit` выключен.
- Полный CLI-референс zond — `ZOND.md`. README — для пользователей.
