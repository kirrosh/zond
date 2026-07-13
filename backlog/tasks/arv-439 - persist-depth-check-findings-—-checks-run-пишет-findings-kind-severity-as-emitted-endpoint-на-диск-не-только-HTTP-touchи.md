---
id: ARV-439
title: >-
  persist depth-check findings — checks run пишет findings
  (kind/severity-as-emitted/endpoint) на диск, не только HTTP-touch'и
status: Done
assignee: []
created_date: '2026-07-13 11:21'
updated_date: '2026-07-13 11:27'
labels:
  - m-29
  - core
  - checks
  - persist
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ключевой анлок m-29 (из оценки ARV-437). Сейчас checks run персистит через audit/persist.ts только HTTP-touch'и (run_kind=check) БЕЗ severity; сами findings живут только в CheckRunData/CheckRunSummary в stdout. Следствие: scorecard показывает 0 findings на аудите, который реально нашёл дрейф; zond-triage и любые 'что упало в прошлом ране' работают только по свежему stdout. Записать findings в запрашиваемое хранилище (по образцу lint_runs): run_id, check_name, kind (status_drift/schema_violation/...), severity-as-emitted (детерминированный closed-enum чека, НЕ калибровка агента), endpoint, count. Литмус: kind+severity чек уже эмитит детерминированно → это plumbing, не суждение. Не добавлять anti-FP/down-rank. Разблокирует ARV-440.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано 2026-07-13. Миграция 0003_check_findings + src/db/check-findings.ts (saveCheckFindings + getCheckFindingsByRunId/ByRunIds). Подключено в checks.ts рядом с audit-persist (тот же run_id, тот же ZOND_CHECKS_PERSIST opt-out). Персистятся детерминированные эмиссии чека (name/severity-as-emitted/category/operation/status/recommended_action), suppressed=1 для ARV-307 broken-baseline. Тесты: tests/db/check-findings.test.ts (5). Проверено вживую: checks run --api github → 21 finding в check_findings. Разблокирует ARV-440.
<!-- SECTION:NOTES:END -->
