---
id: TASK-72
title: 'T72: --tag фильтр молча пропускает файлы с YAML parse error'
status: Done
assignee: []
created_date: '2026-04-29 08:38'
updated_date: '2026-04-29 14:15'
labels:
  - bug
  - parser
  - ux
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond run apis/resend/tests --tag crlf` → "Warning: No suites match the specified tags" — при том что файл с тэгом crlf существует. Реальная причина: файл не загрузился из-за parse error (T71).

Пользователь думает что тэг неправильный, а файл просто не загрузился. UX-катастрофа.

## Что сделать

Tag-discovery должен:
1. Surface'ить parse errors отдельно от tag-mismatch.
2. Считать сколько файлов проигнорировано из-за parse error.
3. Падать с exit 1 если все 'не нашлись' из-за parse-fail.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Если файл не парсится — warning с file:reason, не silent skip
- [x] #2 Если все файлы с тэгом упали при парсе — отдельное сообщение, не 'No suites match'
- [x] #3 Exit-код 1 на parse-error (как validate)
<!-- AC:END -->
