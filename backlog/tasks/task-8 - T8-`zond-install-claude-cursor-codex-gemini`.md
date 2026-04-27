---
id: TASK-8
title: 'T8: `zond install --claude --cursor --codex --gemini`'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-27 11:47'
labels:
  - T8
  - phase-1
  - size-M
dependencies:
  - TASK-5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** One-command onboarding под все MCP-агенты.

**Что.** Команда `zond install` детектит установленные агенты (наличие
`~/.claude/`, `~/.cursor/`, `~/.codex/` и т.п.) и предлагает прописать
MCP-сервер в их конфиги. Флаги — для явного выбора. По умолчанию —
interactive prompt (после T11).

Конфиг для Claude Code:
```jsonc
// ~/.claude/mcp.json
{ "mcpServers": { "zond": { "command": "zond", "args": ["mcp", "start"] } } }
```
Аналогично для остальных — формат у каждого свой, надо зашить шаблоны.

**Файлы.** `src/cli/commands/install.ts`, `src/cli/index.ts`,
`src/core/install/{claude,cursor,codex,gemini}.ts`.

**Зависит от.** T5.

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `zond install --claude` создаёт/обновляет `~/.claude/mcp.json`
- [x] #2 Запускается sanity-check `tools/list` через нового клиента
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MVP: Claude Code + Cursor. Codex/Gemini вынесены в отдельный follow-up — точные пути конфигов для них не зафиксированы в репо.

Архитектура
- `src/core/install/types.ts` — McpClientSpec интерфейс {id, displayName, configPath(home), serverKey, serverEntry}
- `src/core/install/{claude,cursor}.ts` — два spec'а (~/.claude/mcp.json, ~/.cursor/mcp.json), оба пишут одинаковый serverEntry `{ command: "zond", args: ["mcp", "start"] }`
- `src/core/install/index.ts` — CLIENTS registry, `installToClient(spec, opts)` с idempotent merge: парсит существующий JSON, мержит mcpServers без потери других серверов, на unparseable JSON бросает (не клобирует)
- `resolveHome()` читает `process.env.HOME` каждый раз (os.homedir() кеширует значение и ломает тесты с переключением HOME)

CLI
- `zond install --claude --cursor --all --dry-run --no-sanity --json` (`src/cli/commands/install.ts`)
- Без флагов — exit 1 с подсказкой; интерактивный picker — отдельной задачей (T11/T14)
- После записи — sanity check через InMemoryTransport: поднимает локальный MCP server, делает tools/list + resources/list + resources/templates/list, репортит counts (закрывает AC#2)
- Warning если `Bun.which("zond")` пусто (бинарь не в PATH)

Тесты `tests/cli/install.test.ts`
- core: создание / idempotency / merge с другим сервером / dry-run / non-JSON throw / cursor path
- CLI: AC#1 (--claude пишет файл), --all, no-flags exit 1, --dry-run без файлов, AC#2 (--json envelope содержит sanity с tools>0, resources=8, templates=2)

Зарегистрирована в `package.json` test:unit.

Verification: 595 pass / 1 skip / 0 fail; tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано
Команда `zond install --claude --cursor [--all] [--dry-run] [--no-sanity] [--json]` для one-command онбординга MCP-сервера в Claude Code и Cursor.

**Поведение:**
- `--claude` → пишет `~/.claude/mcp.json` с `mcpServers.zond = { command: "zond", args: ["mcp", "start"] }`
- `--cursor` → то же для `~/.cursor/mcp.json`
- `--all` → оба клиента
- Безопасный merge: если файл существует с другим server'ом (например, backlog) — он сохраняется
- Idempotent: повторный запуск возвращает `noop`
- На unparseable JSON бросает, не клобируя пользовательскую конфигурацию
- После записи — sanity check (in-process MCP-клиент через InMemoryTransport) выводит `tools/list=N, resources/list=8, templates=2` (AC#2)
- Warning если `zond` не в PATH

**Файлы:**
Создано: `src/core/install/{types,claude,cursor,index}.ts`, `src/cli/commands/install.ts`, `tests/cli/install.test.ts`
Изменено: `src/cli/program.ts` (регистрация команды), `package.json` (test:unit)

**Scope MVP:** Claude Code + Cursor. Codex/Gemini не включены — точные пути конфигов не зафиксированы; добавим отдельной follow-up задачей при необходимости.

## Verification
- `bun run check` — clean
- `bun run test:unit` — 595 pass / 1 skip / 0 fail (+11 install tests)
- `zond install --claude --json` (вручную через сборку) корректно работает
<!-- SECTION:FINAL_SUMMARY:END -->
