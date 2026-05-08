---
id: TASK-259
title: 'probes: мутируют live-state, FK-fixtures становятся stale в середине сессии (без warning)'
status: To Do
assignee: []
created_date: '2026-05-08 14:30'
labels:
  - feedback-loop
  - api-sentry
  - probes
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12#F5, class ux-papercut + missing-feature.

Probes (особенно `mass-assignment`) создают и удаляют ресурсы на target-API. После probe-run `.env.yaml`-fixtures разваливаются: ID меняются, slug перевыпускается, monitors удалены. Между probe-run и обычными CRUD-сьютами FK становятся stale → `re-create project rule` 200, потом `DELETE rule {{stale_id}}` 404. Кроме того, mass-assignment оставляет orphan-resources (4 cleanup-failure в feedback-12, см. api-bugs-12.md).

Repro:
```
# Перед probe-mass-assignment seeded:
#   project_id_or_slug=zond-test-project
#   monitor_id_or_slug=zond-test-monitor
#   alert_rule_id=17026503  rule_id=17026719  team_id_or_slug=zond-test-team
zond probe mass-assignment --api sentry --env apis/sentry/.env.yaml ...
# После:
#   GET /projects/{org}/{proj}/      → 200, slug → p7d5c2a5 (renamed)
#   GET /monitors/zond-test-monitor/ → 404 (deleted)
#   GET /alert-rules/17026503        → 404 (deleted)
#   GET /projects/.../rules/         → 200 c НОВЫМ id 17026737
```

Impact: добиться стабильного >80% coverage без ручных пересиживаний фикстур невозможно, если probes стоят между CRUD-сьютами.

Expected (любой из):
- probes используют ephemeral resources (создают–чинят–удаляют, не трогая seeded fixtures);
- либо явный warning перед мутацией: `WARNING: probe-mass-assignment will mutate live data; back up env or use --dry-run`;
- либо после probe-run автоматически re-run discover для обновления fixtures + cleanup orphan-resources.

Actual: тихая мутация + cleanup-failure orphans.

Log: /tmp/zond-fb/sentry/rounds/raw-12.log + api-bugs-12.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Перед запуском mutating-probes печатается явный warning о live-state мутациях с подсказкой `--dry-run` (если такой режим есть/появится).
- [ ] Решение для FK-divergence: либо probes юзают ephemeral resources, либо после probe-run печатают `fixtures may be stale; re-run discover` + список изменённых FK.
- [ ] Cleanup-failures (orphan resources) репортятся в exit-summary с явным «N orphans, see api-bugs-NN.md».
- [ ] Verify: tests-run → probes-run → tests-run на тех же fixtures работает без 404 на seeded ID, либо есть чёткий путь восстановления.
<!-- SECTION:ACCEPTANCE:END -->
