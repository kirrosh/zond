---
id: TASK-10
title: 'T10: Решить судьбу `.claude-plugin/`'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-29 14:06'
labels:
  - T10
  - phase-2
  - size-S
dependencies:
  - TASK-9
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Backlog.md обходится без плагина — MCP-сервер достаточно. Плагин
тяжело обновлять (см. жалобу пользователя).

**Что.** Два варианта на выбор:

**Вариант A — удалить.** Marketplace-листинг убрать, README направить на
`zond install --claude`. Плагин-маршрут — deprecated.

**Вариант B — оставить как 5-строчный шим.** В `plugin.json`:
- удалить `hooks` (они нужны были, потому что не было MCP);
- skills/commands оставить как fallback для пользователей без MCP;
- основной инсталл — через `zond install`.

Рекомендация: **A**, как только T5–T9 готовы и стабильны. До тех пор — B,
чтобы не ломать существующих пользователей.

**Файлы.** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`README.md`.

**Зависит от.** T5, T6, T7, T9.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Вариант A: `.claude-plugin/` удалён, README не упоминает маркетплейс
- [ ] #2 Вариант B: плагин содержит только пойнтер на MCP-инсталл
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Выбран Вариант A — полное удаление.

Удалено:
- `.claude-plugin/` (plugin.json + marketplace.json)
- `scripts/sync-version.ts` (синхронизировал версию между package.json и plugin.json)
- `tests/version-sync.test.ts` (проверял ту синхронизацию)

package.json:
- удалены скрипты `version:sync` и `postversion` (последний делал git add .claude-plugin/plugin.json)
- удалён `tests/version-sync.test.ts` из test:unit

README.md и docs/quickstart.md:
- секция Quick Start переписана: `curl install.sh` → `zond install --claude` (или `--cursor`/`--all`)
- сохранён CLI/binary fallback и инструкция по ручному MCP-конфигу для тех, кто не хочет zond install
- TODO-комментарий в README обновлён на новый flow

Не трогалось:
- skills/ (T9 уже сделал)
- commands/ (живут отдельно от .claude-plugin/, их судьба — TASK-11)

AC#2 «Вариант B» помечен как N/A (выбран Вариант A).

Verification: 594 pass / 1 skip / 0 fail; tsc clean; grep подтвердил отсутствие residual ссылок на claude-plugin/marketplace.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано
Вариант A — полное удаление `.claude-plugin/` после стабилизации T5-T9. Marketplace-маршрут больше не упоминается.

**Удалено:**
- `.claude-plugin/` (plugin.json + marketplace.json)
- `scripts/sync-version.ts` (синхронизировал версию плагина с package.json)
- `tests/version-sync.test.ts`
- `package.json`: скрипты `version:sync` и `postversion`

**Переписано:**
- `README.md` Quick Start → `zond install --claude/--cursor/--all` + CLI/binary fallback
- `docs/quickstart.md` Шаг 3 — то же

Skills/ остались (T9 уже сделал тонкие оркестраторы), commands/ — судьба в TASK-11.

## Verification
- tsc clean
- 594 pass / 1 skip / 0 fail
- `grep -r "plugin marketplace\|claude-plugin\|zond-marketplace"` — пусто (по всему репо вне backlog/)
<!-- SECTION:FINAL_SUMMARY:END -->
