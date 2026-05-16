---
id: TASK-245
title: 'generator: эмитит "(DEPRECATED) ..." эндпоинты без --include-deprecated (Sentry помечает в summary, не deprecated:true)'
status: Done
assignee: []
created_date: '2026-05-08 13:00'
updated_date: '2026-05-08 13:40'
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
- [x] Эвристика matches `(DEPRECATED) ...`/`[DEPRECATED] ...`/`DEPRECATED: ...` в `summary`, `operationId` (Sentry кладёт сюда!) и `description` + markdown `## Deprecated` heading в description.
- [x] Подключено к существующему фильтру (TASK-80) — TASK-80's warning «Skipped N deprecated endpoint(s) — pass --include-deprecated» автоматически срабатывает.
- [x] Verify Sentry: `zond generate --api sentry --tag Alerts` → `⚠ Skipped 10 deprecated endpoint(s)`, в `crud-*.yaml` 0 DEPRECATED-step'ов.

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `src/core/generator/openapi-reader.ts`: новая `isMarkedDeprecatedInText(summary, description, operationId)`. Sentry помечает deprecated именно в `operationId` (`"(DEPRECATED) List ..."`) и markdown-header в description (`"## Deprecated"`), не в `deprecated: true` flag.
- Два regex: `DEPRECATED_PREFIX_RE` (для summary/operationId/description-prefix) и `DEPRECATED_HEADING_RE` (markdown `## Deprecated`).
- Подключено к `endpoint.deprecated` ИЛИ — downstream filter в suite-generator уже работает.
<!-- SECTION:NOTES:END -->
<!-- SECTION:ACCEPTANCE:END -->
