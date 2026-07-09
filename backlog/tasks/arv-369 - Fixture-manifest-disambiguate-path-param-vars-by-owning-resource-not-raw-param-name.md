---
id: ARV-369
title: >-
  Fixture manifest: disambiguate path-param vars by owning resource, not raw
  param name
status: To Do
assignee: []
created_date: '2026-07-08 10:46'
labels:
  - fixtures
  - doctor
dependencies: []
references:
  - reports/docgen-api-v30/20260708-131254/report-zond.md#MF1
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
На спеках, где один и тот же path-param name (`code`, `id`, `key`) переиспользуется на разных ресурсах, zond иногда схлопывает их в ОДНУ shared fixture-переменную, если они не резолвятся к одному владеющему ресурсу — напр. docgen-core-service v30 имеет {code} на external-systems/macros/sequence-items (сгруппированы под одним `code`) И на templates/textblocks/template-groups/sequences (резолвятся отдельно/не резолвятся вовсе). Одно значение `code` удовлетворяет только первую группу; `zond run` на остальных даёт каскад false-negative 404 (~15+ эндпоинтов пострадало в реальном скане).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Деривить имя fixture-переменной от владеющего ресурса (через .api-resources.yaml), а не от сырой строки path-param — так `macros_code`, `external_systems_code`, `sequence_items_code` и т.д. станут отдельными manifest-записями, даже если в OpenAPI спеке параметр называется одинаково `code` везде.
<!-- SECTION:PLAN:END -->
