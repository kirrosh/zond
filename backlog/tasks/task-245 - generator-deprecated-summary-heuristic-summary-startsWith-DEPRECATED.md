---
id: TASK-245
title: 'generator: эмитит "(DEPRECATED) ..." эндпоинты без --include-deprecated (Sentry помечает в summary, не deprecated:true)'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
labels:
  - feedback-loop
  - api-sentry
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-09#F3, re-confirmed feedback-10 (NOT fixed), class likely_bug.
Связано с TASK-80 (закрыт; работает только для `deprecated: true`).

Repro:
```
zond generate --api sentry --output /tmp/g --tag Alerts
grep -c "DEPRECATED" /tmp/g/crud-alert-rules.yaml /tmp/g/smoke-*-positive.yaml
# → 5 в crud-alert-rules.yaml, 5 в crud-rules.yaml — ВСЁ deprecated
```

Root cause: generator проверяет только `operation.deprecated === true`. Но Sentry (и другие API в естественной природе) маркируют deprecated в `summary` или `description`: `"summary": "(DEPRECATED) List ..."`. Fallback-эвристика отсутствует.

Expected: без `--include-deprecated` skip endpoint'ов, у которых summary или description начинается с `(DEPRECATED)` / `[DEPRECATED]` / `Deprecated:` (case-insensitive). Warning: "Skipped N deprecated endpoints (detected via summary/description)".

Actual: 4-5 явно мёртвых тестов на каждый CRUD-сьют.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Эвристика: `summary`/`description` matches `^\s*[\(\[]?DEPRECATED[\)\]]?[\s:]` → считается deprecated.
- [ ] Эвристика подключена к тому же фильтру, что и `deprecated: true` (TASK-80).
- [ ] Verify: `crud-alert-rules.yaml`, `crud-rules.yaml` без `--include-deprecated` → 0 DEPRECATED-step'ов.
<!-- SECTION:ACCEPTANCE:END -->
