---
id: ARV-133
title: >-
  prepare-fixtures --cascade --seed: path-params без FK-edge не атакуются, хотя
  list-endpoint возвращает данные
status: Done
assignee: []
created_date: '2026-05-11 17:53'
updated_date: '2026-05-11 18:06'
labels:
  - feedback-loop
  - api-resend
  - m-17
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11 (fb-01), finding F2, severity HIGH, class likely_bug.

Repro:
  zond doctor --api resend --missing-only --json | jq '.data.fixtures.required[].name'
  # 12 UNSET: api_key_id, attachment_id, automation_id, contact_id, domain_id,
  # email_id, id, identifier, log_id, run_id, segment_id, webhook_id
  zond prepare-fixtures --api resend --apply --cascade --seed
  # → fills contact_id, email_id, пытается automation_id (422). Финальная строка:
  # «Filled 2/3 path-FK vars (67%)» — eligible считались только 3 var-а.

Expected: каждый required path-param из .api-fixtures.yaml, у которого resources-map знает соответствующий list-endpoint (по имени ресурса либо по суффиксу _id/_uuid/_slug), должен быть атакован в один из cascade-pass-ов — даже если var не является FK-зависимостью для другого ресурса.

Actual: 9 из 12 missing path-params не вошли в кандидаты cascade (domain_id, api_key_id, webhook_id, segment_id, log_id, run_id, identifier, id, attachment_id). При этом `zond request GET /<resource> | jq .body.data[0].id` извлекает их одной командой → алгоритм реализуем.

Follow-up of ARV-69 (harvest GET-on-list done): ARV-69 покрывал случай, когда var это FK для другого ресурса. F2 — про root-level required vars без FK-edge.

Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log секция === prepare-fixtures ===.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cascade kandidates строятся из union(manifest.required, fkDependencies), а не только из fk-edges
- [x] #2 var name matches existing resource (по basePath / idParam / суффиксу _id) → используется list-endpoint этого ресурса для harvest
- [x] #3 если list-endpoint вернул [] или 404 — explicit «no-data» miss-status (ARV-99), а не silent skip
- [x] #4 regression: 9 missing vars в resend (domain_id/api_key_id/webhook_id/segment_id/log_id/run_id/identifier/attachment_id/automation_id) попадают в attempt-список после --cascade
<!-- AC:END -->
