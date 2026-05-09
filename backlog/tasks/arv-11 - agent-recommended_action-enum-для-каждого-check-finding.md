---
id: ARV-11
title: 'agent: recommended_action enum для каждого check finding'
status: To Do
assignee: []
created_date: '2026-05-09 15:48'
labels:
  - agent
  - m-15
  - depth
  - vector-3
dependencies:
  - ARV-2
  - ARV-3
  - ARV-4
milestone: m-15
priority: medium
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Unit-таблица: [check_id, response_signature] → expected_action на каждой паре
- [ ] #2 JSON envelope finding содержит recommended_action на каждом check-finding
- [ ] #3 SARIF result содержит properties.recommendedAction
- [ ] #4 Skill zond-checks (ARV-12) использует enum для триажа
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Расширить существующий enum (был только в `db diagnose`, m-13) на все типы finding-ов.

Значения для check-findings:
- `report_backend_bug` — 5xx на легитимный негативный input.
- `update_spec` — код успеха не в spec.
- `tighten_validation` — сервер принял невалидное.
- `fix_auth_config` — security настройки сломаны.
- `add_required_header` — server должен enforce header.
- `wontfix_known_limitation` — известное ограничение.

Маппинг: per-check таблица `<check_id, response_pattern> → recommended_action`. Например:
- `not_a_server_error` + 5xx на bogus path-id → `report_backend_bug`,
- `status_code_conformance` + код успеха не в spec → `update_spec`,
- `negative_data_rejection` + 200 на bogus body → `tighten_validation`.

Вписать в SARIF result как `properties.recommendedAction` (см. ARV-5).
<!-- SECTION:PLAN:END -->
