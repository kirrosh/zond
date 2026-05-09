---
id: ARV-5
title: >-
  report: SARIF v2.1.0 reporter с stable partialFingerprints для GitHub Code
  Scanning
status: To Do
assignee: []
created_date: '2026-05-09 15:46'
labels:
  - report
  - m-15
  - depth
  - sarif
  - ci
dependencies:
  - ARV-1
milestone: m-15
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sarif-валидация: tests/core/reporter/sarif.test.ts прогоняет вывод через ajv + sarif-2.1.0 schema, всё валидно
- [ ] #2 Snapshot-тест: 3 finding'а → стабильный SARIF JSON
- [ ] #3 Stability-тест: один и тот же finding в 2 runs → одинаковый partialFingerprints.primary
- [ ] #4 ci-init шаблон проходит actionlint
- [ ] #5 Реальный SARIF файл успешно загружается в GitHub Code Scanning (ручной smoke-тест)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Новый репортер `src/core/reporter/sarif.ts`. SARIF v2.1.0:
   - `runs[].tool.driver = { name:"zond", version, informationUri, rules:[...] }`,
   - `results[].ruleId = <category>-<check_id>` (oasdiff-стиль),
   - `results[].level` (error/warning/note из severity),
   - `results[].locations[].physicalLocation.artifactLocation.uri = "spec.json"`,
   - `results[].locations[].physicalLocation.region.snippet` = jsonPointer на operation,
   - `results[].partialFingerprints.primary = sha1(ruleId + jsonPointer + spec_hash)` (42Crunch-стиль).
2. CLI: `zond report sarif --run-id <id> --output out.sarif` + флаг `--report sarif` в `zond checks run`.
3. Обновить `zond ci init` шаблон с шагом `github/codeql-action/upload-sarif@v3`.
4. JSON Schema валидация выхода — `@types/sarif` schema.
5. `properties.recommendedAction` на result (берётся из ARV-K).
<!-- SECTION:PLAN:END -->
