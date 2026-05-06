---
id: TASK-168
title: apply sanitizer in exporters (HTML / JSON / JUnit / case-study / digest)
status: To Do
assignee: []
created_date: '2026-05-06 06:55'
labels:
  - redaction
  - exporter
  - secrets
dependencies:
  - TASK-166
milestone: m-10
priority: high
---

## Description

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

## Acceptance Criteria

- [ ] HTML-report не содержит зарегистрированных секретов (smoke test с echo-API).
- [ ] JSON reporter не содержит секретов.
- [ ] JUnit XML не содержит секретов.
- [ ] case-study `.md` не содержит секретов.
- [ ] probe-digest файлы не содержат секретов.
- [ ] stdout `--verbose` показывает `<redacted:auth_token>` вместо raw.
- [ ] `--no-redact` отключает на всех путях.
- [ ] Документация: список redaction points в `docs/secrets.md`.
