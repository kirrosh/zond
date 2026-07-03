---
id: ARV-175
title: >-
  schema-from-runs: zond command — extract response bodies, quicktype/genson →
  patch.schema.json
status: To Do
assignee: []
created_date: '2026-05-12 13:26'
updated_date: '2026-07-03 15:53'
labels:
  - depth
  - quicktype
  - deferred-m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Блок A m-18. Оживить `response_schema_conformance` на API где spec не
объявляет response schemas (Sentry: 207/209 endpoint'ов skipped).\n\nКоманда `zond schema-from-runs --run <id>` экспортирует 2xx body из\n`zond.db results.response_body`, прогоняет через quicktype или genson,\nвыдаёт `patch.schema.json` с ключами по endpoint+status.\n\n## Параметры\n\n- `--run <id>` — конкретный run; по умолчанию latest\n- `--min-samples <n>` — минимум 2xx samples на endpoint, иначе skip\n- `--out <path>` — путь для patch.schema.json\n- `--engine quicktype|genson` — выбор schema-генератора\n\n## Зависимости\n\n- ARV-175 (refresh-api merge-schema) — пара для патчинга spec\n- ARV-111 (.api-resources.local.yaml extension mechanism)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond schema-from-runs --run <id> экспортирует 2xx body группированно по endpoint+status
- [ ] #2 поддержка quicktype и genson через --engine; результат — валидный JSON Schema под application/json
- [ ] #3 endpoints с <min-samples 2xx скипаются с понятным warning
<!-- AC:END -->
