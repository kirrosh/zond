---
id: ARV-26
title: >-
  response_schema_conformance probe misses format violations caught by
  --validate-schema
status: Done
assignee: []
created_date: '2026-05-10 08:27'
updated_date: '2026-05-10 08:36'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 06, finding F1, class definitely_bug
Repro: zond checks run --api resend --check response_schema_conformance --include 'path:^/webhooks$' → 0 findings; zond run apis/resend/tests/smoke-webhooks-positive.yaml --validate-schema --spec apis/resend/spec.json → 9 errors on body.data.N.created_at format date-time
Expected: либо probe тоже валидирует format (date-time/email/uri/uuid/...), либо в сообщении probe явно сказано 'format-keyword не проверяется в probe-режиме — используйте zond run --validate-schema'
Actual: два валидатора в одном бинаре дают разный вердикт на тот же endpoint+ответ
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-06.log (block 'M. response_schema_conformance + format strict?')
<!-- SECTION:DESCRIPTION:END -->
