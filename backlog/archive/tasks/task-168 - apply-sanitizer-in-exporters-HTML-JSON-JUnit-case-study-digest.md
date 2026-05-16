---
id: TASK-168
title: apply sanitizer in exporters (HTML / JSON / JUnit / case-study / digest)
status: Done
assignee: []
created_date: '2026-05-06 06:55'
updated_date: '2026-05-06 10:11'
labels:
  - redaction
  - exporter
  - secrets
milestone: m-10
dependencies:
  - TASK-166
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §3.

Даже после redaction в БД (TASK-167) есть пути, которые формируются
runtime'ом и могут содержать секрет:

- HTML-export (`src/core/exporter/html-report/index.ts`)
- JSON / JUnit reporter'ы (`src/core/reporter/junit.ts`, json reporter)
- case-study generator (`src/core/diagnostics/render-md.ts`)
- digest файлы из `probe-* --output`
- stdout `--verbose` (live request/response logging)

Зависит от TASK-166 (registry).

## Что сделать

1. **HTML-report:** обернуть выход renderer'а в `registry.redact()`,
   либо обработать каждый field перед HTML-escape.
2. **JUnit XML:** redact в `error_message`, `system-out`, `system-err`.
3. **JSON reporter:** redact в финальном payload.
4. **case-study `render-md.ts`:** redact в всех cell'ах таблиц,
   особенно request/response sections.
5. **digest** (probe-security, probe-mass-assignment): redact в
   markdown-output'е перед write.
6. **stdout `--verbose`:** wrap http-client log lines через redact.
7. Один центральный «exit point» — все persisted-artifact write'ы
   проходят через registry. Документировать список интеграций в
   `docs/secrets.md` (или ZOND.md).
8. `--no-redact` распространить на все эти пути.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 HTML-report не содержит зарегистрированных секретов (smoke test с echo-API).
- [ ] #2 JSON reporter не содержит секретов.
- [ ] #3 JUnit XML не содержит секретов.
- [ ] #4 case-study `.md` не содержит секретов.
- [ ] #5 probe-digest файлы не содержат секретов.
- [ ] #6 stdout `--verbose` показывает `<redacted:auth_token>` вместо raw.
- [ ] #7 `--no-redact` отключает на всех путях.
- [ ] #8 Документация: список redaction points в `docs/secrets.md`.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
JSON/JUnit reporters: generateJunitXml/generateJsonReport применяют redact() к финальному payload. probe-security и probe-mass-assignment: registerAll(vars) + redact(formatDigest) перед write/stdout. report export (HTML) и report case-study: defensive redact() на финальный output. ZOND.md содержит таблицу redaction points. 3 новых регрессионных теста (json/junit/disabled). 996/996 tests pass.
<!-- SECTION:NOTES:END -->
