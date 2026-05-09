---
id: TASK-267
title: >-
  docs/UX: группировать `zond --help` по фазам + discoverability для
  $randomSlug/Email/Url helpers
status: To Do
assignee: []
created_date: '2026-05-08 15:00'
updated_date: '2026-05-09 09:06'
labels:
  - feedback-loop
  - docs
  - cli
  - ux
milestone: m-14
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "Документация / discovery".

1. **`zond --help` показывает 30+ команд плоским списком.** Тестер просил группировать:
   - **setup**: `add api`, `bootstrap`, `discover`, `clean`, `doctor`
   - **generate**: `generate`, `probe-validation`, `probe-methods`
   - **run**: `run`, `session`, `probe`
   - **analyze**: `coverage`, `db diagnose`, `db runs`
   - **report**: `report`, `serve`, `audit`
   - **other**: `validate`, `request`, `ci`

2. **`$randomSlug`/`$randomEmail`/`$randomUrl` появляются в выводе `generate`, но нигде не задокументированы.** Пользователь не знает, что они существуют. Решения:
   - `zond reference random-helpers` или `zond help random-helpers` — печатает таблицу всех `$random*` helpers с примерами.
   - Альтернативно: блок «Random helpers» в выводе `zond generate --help`.
   - Документ `docs/random-helpers.md` (uniform reference) + ссылка из `--help`.

3. **Cookbook**: `docs/cookbook/<api>.md` для Sentry/Stripe/Petstore с типовыми сценариями «3 команды от пустоты до 80%». Если TASK-262 (`zond audit`) сделан, cookbook сводится к одной команде.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 `zond --help` группирует команды по фазам (setup/generate/run/analyze/report/other).
- [ ] #2 `zond reference random-helpers` (или эквивалент) перечисляет все `$random*` с описанием и пример output.
- [ ] #3 `docs/random-helpers.md` существует и упомянут в `generate --help`.
- [ ] #4 (опционально) `docs/cookbook/sentry.md` с типовым flow.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->
