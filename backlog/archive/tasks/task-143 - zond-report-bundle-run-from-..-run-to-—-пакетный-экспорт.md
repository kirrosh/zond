---
id: TASK-143
title: zond report bundle <run-from>..<run-to> — пакетный экспорт
status: Done
assignee: []
created_date: ''
updated_date: '2026-05-08 16:03'
labels:
  - report
  - export
milestone: m-8
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Поддержка трёх форм диапазона: `A..B`, список через запятую,
      `--session <id>`.
- [ ] #2 Сводный `index.md` с таблицей и ссылками.
- [ ] #3 `--include` фильтрует артефакты.
- [ ] #4 Тесты на сборку bundle на фикстуре с 3 run'ами.
- [ ] #5 Скилл Phase 7 обновлён с примером.
- [ ] #6 CHANGELOG.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
report bundle <range> с тремя формами: A..B, A,B,C, --session <id>. Артефакты: case-study (только при failures), report.html, diagnose.json + index.md с таблицей. --include фильтрует. --body-cap forward в обоих рендерерах. 9 unit-тестов. Скилл Phase 7 обновлён.
<!-- SECTION:NOTES:END -->
