---
id: TASK-279
title: 'lint-spec: grouping by rule × severity-filter вместо стены из 714 строк'
status: Done
assignee: []
created_date: '2026-05-08 19:00'
updated_date: '2026-05-08 14:09'
labels:
  - feedback-loop
  - api-sentry
  - lint-spec
  - ux
dependencies:
  - TASK-46
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14#F6, class ux-papercut.

`zond lint-spec` на Sentry-spec'е выдаёт 714 issues в плоском списке. 399 из них HIGH, но 385 — это **один rule (B1, path-param без format/pattern) × 385 endpoints**. Чтобы оценить масштаб и приоритезировать, приходится `grep '(B1)' | wc -l`.

Expected — компактная сводка top-level + полный список под флагом:
```
B1 (HIGH) — 385 endpoints — path-param missing format/pattern
B6 (MED)  — 112 endpoints — field "email"/"url" missing format
B8 (HIGH) — 61 endpoints  — additionalProperties not set
...
```

Полный flat-list — под `--verbose` или `--json`.

Опции:
- `--severity <high|med|low>` — фильтр по severity (default: all, но summary всегда включает все).
- `--rule <B1,B6>` — выводить только указанные правила.
- `--top N` — top-N rules по count (для quick triage).
- Default-вывод — group-by-rule summary (как пример выше) + total.
- `--verbose` (или `--flat`) — текущее поведение, плоский список.
- `--json` — структурированно `{rule, severity, message, count, occurrences:[...]}`, с occurrences не флатно.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 Default-вывод `lint-spec` — group-by-rule summary (rule × severity × count × short-message), отсортирован по severity desc, count desc.
- [ ] #2 `--verbose`/`--flat` сохраняет текущий 1-строка-на-issue вывод.
- [ ] #3 `--severity` / `--rule` / `--top` фильтры реализованы и документированы в `--help`.
- [ ] #4 `--json` envelope содержит и summary, и occurrences; зафиксирован в существующем JSON-envelope-policy module (TASK-184).
- [ ] #5 Verify на Sentry-spec: default-вывод укладывается в ~30 строк summary вместо 714.
- [ ] #6 Regression-snap test: фиктивная spec с 3 rule × N occurrences → ожидаемый summary.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->
