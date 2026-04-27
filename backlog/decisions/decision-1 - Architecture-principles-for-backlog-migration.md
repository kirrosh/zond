---
id: decision-1
title: Architecture principles for backlog migration
date: '2026-04-27 10:10'
status: accepted
---
## Context

Анализ репозитория [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md)
(Bun + TS, ~5.4k★) показал, что zond выбирает архитектурно более слабый путь —
ставка на Claude Code-плагин вместо MCP-сервера. Backlog.md держит **один
бинарник = CLI + MCP + web + контент-ресурсы + один номер версии**, что
снимает drift и проблему обновления плагина. Эти принципы фиксируем как
opinionated рамку для задач T5–T16.

## Decision

1. **Один бинарник, один source tree, одна версия.** CLI и MCP — два
   entry-point поверх общего `src/core/*`. Drift физически невозможен.
2. **Write остаётся за агентом.** YAML-тесты, `.env.yaml`, fixtures — через
   Read/Write/Edit агента. MCP-обёртки для редактирования файлов **не делаем**.
3. **MCP-тулза существует, только если возвращает structured-результат**,
   который агенту иначе пришлось бы парсить из stdout. Run, diagnose,
   describe, query DB, request — да. Create/edit YAML — нет.
4. **Скилл-контент живёт как MCP-ресурсы внутри бинарника**, не как файлы на
   диске. Грузится по запросу, не всегда в системном промпте.
5. **CLI — для людей и CI.** Все агентские флоу проходят через MCP, всё
   остальное — через CLI. Оба зовут общее ядро.

### Non-goals (намеренно отказываемся)

- React 19 SPA для дашборда — текущий HTMX+Hono сильнее под наш read-mostly
  сценарий.
- TUI на blessed — нет аналога Kanban-канбана, +1MB к бинарнику без выгоды.
- Filesystem-only mode без SQLite — runs машинные, нужен JOIN.
- Zero-padded id (`run-001`) — косметика без выгоды.
- MCP-обёртки `zond_create_test`, `zond_edit_yaml` — Write справляется.

## Consequences

- Все задачи фазы 1 (T5–T8) подчинены принципу 1 — общий core, тонкий MCP-слой.
- Задачи фазы 2 (T9–T11) последовательно сжимают альтернативные пути доставки
  (skills, plugin, slash-команды) до тонких шимов или удаления.
- Принцип 2 запрещает определённый класс будущих MCP-тулз — это сознательный
  отказ ради простоты.
- Релизный поток: `bun run build` → `dist/zond` (CLI + MCP + web + ресурсы),
  `npm publish` — тонкий shim-пакет. Один тег версии на всё.
