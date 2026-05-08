---
id: TASK-280
title: 'coverage --json: отдельные covered2xx / coveredButNon2xx / unhit (не только coveredEndpoints + partialEndpoints)'
status: To Do
assignee: []
created_date: '2026-05-08 19:00'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - json-envelope
  - ux
dependencies:
  - TASK-184
  - TASK-250
  - TASK-274
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14#F8, class json-envelope-inconsistency.

При `coverage --union session --json` envelope содержит:
- `coveredEndpoints` (172) — все hit endpoints (включая 4xx/5xx);
- `partialEndpoints` (47) — семантика непрозрачна (вероятно «hit но не 2xx»);
- нет отдельного списка endpoints, прошедших 2xx.

В то же время не-JSON вывод явно делит:
```
✅ 67 covered (passing 2xx)
⚠ 152 hit but non-2xx
❌ 0 unhit
```

Семантика расходится между текстовым и JSON выводом → инструменты, читающие JSON, не могут получить тот же breakdown.

Expected — JSON envelope содержит явные категории, согласованные с текстовым:
```json
{
  "totals": {"all": 219, "covered2xx": 67, "coveredButNon2xx": 152, "unhit": 0},
  "covered2xxEndpoints":      [{"method":"GET","path":"/...", "lastStatus":200}, ...],
  "coveredButNon2xxEndpoints":[{"method":"PUT","path":"/...", "lastStatus":502}, ...],
  "unhitEndpoints":           [...]
}
```

`coveredEndpoints` / `partialEndpoints` оставить deprecated-aliases с warning в stderr (или сразу drop по правилу envelope-policy, см. TASK-184).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] JSON envelope `coverage` содержит `covered2xxEndpoints`, `coveredButNon2xxEndpoints`, `unhitEndpoints` как отдельные массивы.
- [ ] `totals` включает `covered2xx`/`coveredButNon2xx`/`unhit` параллельно с существующими полями.
- [ ] Семантика 1-в-1 совпадает с не-JSON выводом (`✅ N covered (passing 2xx)` == `totals.covered2xx == covered2xxEndpoints.length`).
- [ ] Обратная совместимость: `coveredEndpoints`/`partialEndpoints` либо deprecated с warning, либо drop'нуты под mention в CHANGELOG (решение в рамках envelope-policy module).
- [ ] Регрессионный test на JSON snapshot для fixture-run с 3 endpoints (один 2xx, один 4xx, один не hit).
- [ ] ZOND.md / `--help` для `coverage`: документирует категории.
<!-- SECTION:ACCEPTANCE:END -->
