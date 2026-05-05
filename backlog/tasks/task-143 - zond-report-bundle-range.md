---
id: TASK-143
title: 'zond report bundle <run-from>..<run-to> — пакетный экспорт'
status: To Do
assignee: []
labels:
  - report
  - export
milestone: m-8
dependencies: []
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback §5 раунд 2 (skill)](../notes/m-8-audit-cli-gaps/feedback-original.md).

В Phase 7 «Share findings» хочется одной командой собрать триаж-пакет:
case-studies + HTML-export + diagnose digest для диапазона run-id.
Сейчас 4 run-id × 2 формата = 8 ручных команд.

## Что сделать

Команда: `zond report bundle <run-from>..<run-to> [--output <dir>] [--format html,md] [--include case-study,export,diagnose]`.

1. По диапазону / списку (`135..142`, `135,137,141`, `--session <id>`)
   собрать для каждого run:
   - `<dir>/<run-id>/case-study.md` (если есть FAIL).
   - `<dir>/<run-id>/report.html` (single-file).
   - `<dir>/<run-id>/diagnose.json`.
2. Сводный `<dir>/index.md` с таблицей: run-id, spec, totals, ссылки на
   артефакты, agent_directive из diagnose.
3. Опция `--include` — выбрать подмножество артефактов.
4. Уважать `--body-cap` из TASK-141 для case-studies.

## Acceptance Criteria

- [ ] Поддержка трёх форм диапазона: `A..B`, список через запятую,
      `--session <id>`.
- [ ] Сводный `index.md` с таблицей и ссылками.
- [ ] `--include` фильтрует артефакты.
- [ ] Тесты на сборку bundle на фикстуре с 3 run'ами.
- [ ] Скилл Phase 7 обновлён с примером.
- [ ] CHANGELOG.
