---
id: ARV-10
title: 'report: NDJSON streaming reporter с published JSON Schema'
status: Done
assignee: []
created_date: '2026-05-09 15:47'
updated_date: '2026-05-09 17:54'
labels:
  - report
  - m-15
  - depth
  - ndjson
  - agent
milestone: m-15
dependencies:
  - ARV-1
priority: medium
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Каждое событие — snapshot JSON-line с правильным type
- [x] #2 Pipe-test: bun zond checks run --ndjson | head -3 | jq -c '.type' не ломается
- [x] #3 JSON Schema опубликована в docs/json-schema/ndjson-events.schema.json
- [x] #4 ajv-валидация: каждое сгенерированное событие валидно по schema
- [x] #5 Stdout discipline: при --ndjson stdout содержит только NDJSON, stderr — прогресс
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Новый репортер `--report ndjson` (или global `--ndjson`). Каждое событие — отдельная строка JSON:
- `{"type":"check_start","ts":...,"operation":...}`
- `{"type":"check_result","check":...,"verdict":"pass|fail",...}`
- `{"type":"finding","check":...,"severity":...,"recommended_action":...,...}`
- `{"type":"summary","passed":N,"failed":M,...}`

Schema event-ов в `docs/json-schema/ndjson-events.schema.json`, генерируется из zod (как уже сделано в m-13). Stdout discipline: при `--ndjson` всё человекочитаемое идёт в stderr.
<!-- SECTION:PLAN:END -->
