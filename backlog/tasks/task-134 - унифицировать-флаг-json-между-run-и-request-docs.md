---
id: TASK-134
title: унифицировать флаг --json между run и request (+ docs)
status: To Do
assignee: []
created_date: '2026-05-05 10:04'
labels: []
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`--json` у `zond run` и у `zond request` означает разное (формат отчёта vs формат тела/вывода). Из --help это не очевидно, пользователь натыкается на «unknown option» и идёт читать help каждой подкоманды отдельно.

Надо: либо переименовать конфликтующие флаги, либо явно описать разницу в `--help` обеих команд + раздел в ZOND.md. Минимально — текст подсказки в `--help` про назначение флага.

Источник: фидбэк по JSONPlaceholder (затык №3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond run --help и zond request --help однозначно описывают назначение --json
- [ ] #2 ZOND.md содержит раздел про различия флагов
- [ ] #3 если флаг переименован — старое имя даёт deprecation warning, не unknown option
<!-- AC:END -->
