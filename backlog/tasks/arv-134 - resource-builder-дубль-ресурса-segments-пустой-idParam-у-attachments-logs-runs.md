---
id: ARV-134
title: >-
  resource-builder: дубль ресурса segments + пустой idParam у
  attachments/logs/runs
status: Done
assignee: []
created_date: '2026-05-11 17:53'
updated_date: '2026-05-16 09:20'
labels:
  - feedback-loop
  - api-resend
  - m-17
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11 (fb-01), finding F3, severity MEDIUM, class likely_bug.

Repro:
  grep -E "^  - resource:|^    idParam:" apis/resend/.api-resources.yaml
  # Два entries `segments`:
  #   - segments: basePath=/segments, idParam=id
  #   - segments: basePath=/contacts/{contact_id}/segments, idParam="" (nested)
  # Три ресурса с пустым idParam: attachments, logs, runs
  # При этом spec.json содержит {attachment_id}, {log_id}, {run_id} в item-эндпоинтах
  # (GET /logs/{log_id}, GET /emails/{email_id}/attachments/{attachment_id},
  # GET /automations/{automation_id}/runs/{run_id}).

Expected:
  1. Один entry на canonical resource name; collision (root vs nested) → второй cluster переписать как nested-resource с FK к parent (contact_id).
  2. idParam определять из item-path во всех endpoint-вариантах (включая nested /parent/{parent_id}/child/{child_id}).
  3. Если canonical-кандидатов несколько — выбирать кратчайший item-path.

Actual:
  - Дубль `segments` ломает идемпотентность refresh-api и map-by-name.
  - 3 empty idParam → prepare-fixtures пропускает эти ресурсы при сборке fixtures (F2 — обратная сторона того же).

Log: apis/resend/.api-resources.yaml, генератор src/api-resources/* (или там, где живёт resource-builder).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 no duplicate resource entries в .api-resources.yaml после refresh-api
- [ ] #2 nested resource (basePath с FK-сегментом) хранится с distinct именем (segments_under_contacts или nested:contact_id/segments) или явным фолдом в .fkDependencies
- [ ] #3 idParam извлекается из item-path для каждой ветки spec (логи/attachments/runs получают log_id/attachment_id/run_id соответственно)
- [ ] #4 regression: resend .api-resources.yaml после refresh-api не содержит пустых idParam там, где spec предоставляет item-path с named param
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in resources-builder.ts (m-21).

Two fixes:
1) disambiguateResourceCollisions: when two CRUD groups produce the same resource name (e.g. POST /segments + POST /contacts/{contact_id}/segments → both 'segments'), the strictly-shortest basePath keeps the canonical name; deeper ones get '<parent-noun>_<resource>' (contact_segments). When no strictly-shortest exists (equal-depth collisions), ALL are renamed rather than silently picking by sort order.

2) Implicit list-only resources now recover idParam + itemPath + endpoints.read from a GET-by-id companion (matching pattern listPath + '/{param}'). Falls back to ownerListPaths reverse-map when no item endpoint exists. attachments/logs/runs at Resend get attachment_id/log_id/run_id properly extracted; prepare-fixtures stops skipping them.

Tests: 6 new (resources-builder.test.ts) — parent-prefix collision rename, no-strict-shortest case, single-resource no-op, GET-by-id companion idParam, ownerListPaths fallback, no-signal graceful empty. All 20 in file green; 2218/2218 unit suite green; tsc clean.
<!-- SECTION:NOTES:END -->
