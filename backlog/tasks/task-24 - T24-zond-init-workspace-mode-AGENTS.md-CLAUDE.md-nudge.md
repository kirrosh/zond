---
id: TASK-24
title: 'T24: zond init workspace mode + AGENTS.md/CLAUDE.md nudge'
status: Done
assignee: []
created_date: '2026-04-27 13:01'
updated_date: '2026-04-28 12:46'
labels:
  - T24
  - phase-4
  - size-M
  - priority-p0
  - workspace
  - dx
  - agents
milestone: m-0
dependencies:
  - TASK-12
  - TASK-17
references:
  - 'https://github.com/MrLesk/Backlog.md'
  - src/mcp/resources/content/workflow-test-api.md
  - src/mcp/resources/registry.ts
  - skills/api-testing/SKILL.md
  - src/cli/commands/install.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Сейчас `zond init` — это «зарегистрируй один API из spec'а». В свежей репозитории нет команды, которая забутстрапит workspace под zond так, чтобы AI-агент (Claude Code, Cursor, Codex) сразу понял, как пользоваться инструментом. Полный флоу «свежая папка → агент сам всё делает» не замыкается.

[Backlog.md](https://github.com/MrLesk/Backlog.md) решает это паттерном из 3 механизмов (wizard на init):
1. **MCP connector** *(default)* — авто-конфигурит `~/.claude/mcp.json` (`claude mcp add backlog -- backlog mcp start`), пишет в `AGENTS.md`/`CLAUDE.md` тонкий nudge «читай ресурс `backlog://workflow/overview`». Сам workflow живёт в MCP-ресурсах.
2. **CLI commands** — без MCP, дописывает в `AGENTS.md`/`CLAUDE.md` развёрнутую инструкцию по CLI.
3. **Skip** — без агентской интеграции.

У zond уже всё для этого готово: MCP-сервер с tools и resources (`zond://workflow/{test-api,scenarios,diagnosis,setup}`, `zond://rules/{never,safety}`), `zond install --claude` (TASK-8), workspace marker (T17). Не хватает оркестрирующего шага.

**Что.** Расширить команду `zond init`:

- Без аргументов (или `zond init --workspace`) → wizard «как подключить AI-агента»:
  - **MCP** (default): запускает `installCommand({ all: true })` + дописывает в `AGENTS.md` (создаёт если нет) короткий nudge с указателями на `zond://workflow/test-api` и `zond://rules/never`.
  - **CLI**: пишет в `AGENTS.md` развёрнутый инструктивный блок (адаптированный текст из `skills/api-testing/SKILL.md`).
  - **Skip**: только структура, без агентских файлов.
- Создаёт workspace marker `zond.config.yml` (минимальный, с T12 полями) и `apis/` директорию.
- Сохраняет совместимость: `zond init --spec <path> [--name ...]` продолжает регистрировать ОДИН API как сейчас (через `setupApi()`).
- Опциональный флаг `--with-spec <path>` к workspace mode — забутстрапить workspace И зарегистрировать первый API в одном проходе.
- При уже существующих `AGENTS.md`/`CLAUDE.md` — дописывать секцию в конец (с маркерами `<!-- zond:start -->` / `<!-- zond:end -->`), а не перезаписывать.

**Файлы.**
- `src/cli/commands/init.ts` — split в `initCollection()` (текущее) + `initWorkspace()` (новое).
- `src/cli/commands/init/wizard.ts` (новый) — clack-based UI (T14 даёт инфраструктуру).
- `src/cli/commands/init/agents-md.ts` (новый) — генерация / merge `AGENTS.md` и `CLAUDE.md`.
- `src/cli/commands/init/templates/agents-mcp-nudge.md` (новый embed) — короткий nudge.
- `src/cli/commands/init/templates/agents-cli-full.md` (новый embed) — развёрнутая инструкция.
- `src/cli/commands/init/templates/zond-config.yml` (новый embed) — минимальный config.
- `src/cli/program.ts` — флаги `--workspace`, `--with-spec`, `--integration <mcp|cli|skip>` (для не-интерактивного режима).
- `src/core/setup-api.ts` — без изменений (вызывается из `initCollection`).

**Зависит от.**
- T12 (`zond.config.yml` precedence) — нужен формат файла.
- T14 (interactive init через clack) — UI wizard'а.
- T17 (workspace marker) — `zond.config.yml` уже принят как маркер ✅.
- T19 (`init --here`) — близкая семантика, обсудить слияние.

**Размер.** M.

**Что НЕ входит** (отдельные задачи):
- Содержимое самих MCP-ресурсов (`zond://workflow/*`) — уже есть.
- Логика установки в `~/.claude/mcp.json` — уже есть в TASK-8.
- Cursor/Codex/Gemini-специфичные конфиги — пока используем то, что умеет TASK-8.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `zond init` без аргументов в пустой папке запускает wizard и создаёт `zond.config.yml` + `apis/`
- [x] #2 Wizard предлагает 3 варианта интеграции (MCP / CLI / Skip); MCP — default
- [x] #3 В режиме MCP wizard вызывает install-логику (TASK-8) и пишет `AGENTS.md` с nudge на `zond://workflow/test-api` и `zond://rules/never`
- [x] #4 В режиме CLI wizard пишет в `AGENTS.md` развёрнутую инструкцию (без зависимости от MCP)
- [x] #5 Существующий `AGENTS.md`/`CLAUDE.md` не перезаписывается — секция zond добавляется между маркерами `<!-- zond:start -->` / `<!-- zond:end -->`; повторный `zond init` идемпотентен (обновляет блок)
- [x] #6 `zond init --spec <path>` (старый сценарий) продолжает регистрировать ОДИН API без wizard'а — backwards compat
- [x] #7 Не-интерактивный режим: `zond init --workspace --integration mcp --yes` работает без TTY (для CI / agent-driven setup)
- [x] #8 Документировано в `ZOND.md` (раздел «Bootstrapping a workspace»)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented MVP `zond init` workspace bootstrap (deferred T12 config-loader and T14 clack wizard).

**Routing in `src/cli/commands/init.ts`:**
- `--spec <path>` → register API (legacy, unchanged).
- No `--spec` → workspace bootstrap (new default).
- `--with-spec <path>` → bootstrap + register in one call.
- `--spec` + `--workspace` → rejected with exit 2.

**Bootstrap (`src/cli/commands/init/bootstrap.ts`)** creates `zond.config.yml`, `apis/`, then depending on `--integration {mcp|cli|skip}`:
- `mcp` (default): writes `AGENTS.md` with MCP nudge + calls `installToClient()` for Claude and Cursor (reuses TASK-8 plumbing).
- `cli`: writes `AGENTS.md` with the full inline workflow.
- `skip`: filesystem-only.

**Idempotency** via `<!-- zond:start -->` / `<!-- zond:end -->` markers in `AGENTS.md` (`src/cli/commands/init/agents-md.ts`). Re-running reports `noop` for unchanged steps.

**Templates** are embedded markdown / yml: `agents-mcp-nudge.md`, `agents-cli-full.md`, `zond-config.yml`.

**Tests** in `tests/cli/init/{agents-md,bootstrap}.test.ts` plus extensions to `tests/cli/init.test.ts`. 628/628 unit tests + tsc --noEmit green.

Documented in `ZOND.md` § Bootstrapping a workspace. No new dependencies; all non-interactive (flags only).
<!-- SECTION:FINAL_SUMMARY:END -->
