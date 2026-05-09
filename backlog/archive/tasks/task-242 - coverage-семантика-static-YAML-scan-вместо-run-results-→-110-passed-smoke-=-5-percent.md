---
id: TASK-242
title: 'coverage семантика: static YAML-scan вместо run-results → 110 passed smoke = 5%'
status: Done
assignee: []
created_date: '2026-05-08 12:24'
updated_date: '2026-05-08 12:24'
labels:
  - feedback-loop
  - api-sentry
  - coverage
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-08#F1 (final reproduction of long-deferred bugs feedback-02#F6 / 04#F6 / 05#F1 / 07#F5), class definitely_bug.

Repro: `zond run --tag smoke` → 110 passes; `zond coverage --api sentry` → `10/219 (5%)`. Все 10 covered endpoints — SCIM Groups+Users из единственного полностью прошедшего CRUD-chain. 110 passed smoke 200-OK игнорировались полностью.

Root cause: `coverage` CLI команда использовала статический сканер `scanCoveredEndpoints` (regex-grep по YAML-файлам), а не результаты прогонов. То есть «покрытие» считалось как «endpoint объявлен в YAML», а не «endpoint реально дёрнули и получили 2xx». Плюс в самом сканере был баг со slash-чувствительным regex: `specPathToRegex` сохранял trailing `/`, а `normalizePath` его срезал — поэтому большинство Sentry-путей вообще не матчилось.

В коде уже есть правильный движок `buildCoverageMatrix` + `loadCoverage` (используется в `report --html` и UI-сервере): он считает endpoint covered, когда хотя бы один сохранённый результат прошёл с 2xx.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] `zond coverage --api <name>` использует `loadCoverage`/`buildCoverageMatrix` и считает covered = endpoints с хотя бы одним passing 2xx из последнего прогона.
- [x] `--run-id <N>` пинит конкретный прогон вместо последнего.
- [x] JSON-envelope содержит `covered`, `uncovered`, `partial`, `total`, `percentage`, `runId`, `coveredEndpoints[]`, `partialEndpoints[]`, `uncoveredEndpoints[]`.
- [x] Удалён неработающий статический путь `--tests <dir>`; spec-only fallback (`--spec` без `--api`) явно возвращает 0% с подсказкой зарегистрировать API.
- [x] Воспроизведение на sentry workdir: Run #36 (smoke, 111 pass из 223) → coverage = 88/219 (40%) вместо 10/219 (5%).
- [x] Skill-шаблон `init/templates/skills/zond.md` обновлён: явно прописана run-driven семантика и пиннинг через `--run-id`.
- [x] `bun test` без новых регрессий (2 предсуществующих fail остаются — не связаны).
<!-- SECTION:ACCEPTANCE:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `src/cli/commands/coverage.ts` переписан: основной путь — `runMatrixCoverage` через `loadCoverage`. Spec-only fallback оставлен только для случая «API ещё не зарегистрирован» — он честно возвращает 0% с инструкцией.
- Опция `--tests <dir>` снята: после переключения на run-results она бессмысленна (источник истины — `zond.db`, а не папка YAML).
- `tests/mocked/coverage.ts` переписан под новую семантику.
- Закрывает feedback-08#F1 + ранее deferred feedback-02#F6, 04#F6, 05#F1, 07#F5.
<!-- SECTION:NOTES:END -->
