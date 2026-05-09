---
id: TASK-259
title: 'probes: мутируют live-state, FK-fixtures становятся stale в середине сессии (без warning)'
status: Done
assignee: []
created_date: '2026-05-08 14:30'
updated_date: '2026-05-08 17:30'
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
- [x] Pre-run banner на stderr перед `probe-mass-assignment` и `probe-security` (live-mutating). Список FK-shaped fixture ключей (`*_id`, `*_slug`, `*_uuid`, `*_token`, `monitor_id_or_slug` и т.д.) с предупреждением что они могут стать stale + recovery hint `zond discover --api <name>`. Подавляется в `--json` и `--dry-run`.
- [x] FK-divergence: post-run hint при `cleanedCount > 0` — "N resource(s) created and deleted by probes. FK fixtures in .env.yaml may be stale — re-run zond discover --api <name>". Сделано вместо ephemeral-режима (TASK-264 — отдельно).
- [x] Cleanup-failures: новый shared `countCleanupFailures` (фильтрует 404 как success) + summary line "N orphan resource(s): cleanup DELETE failed (non-404). Manual remediation may be needed". Считается в обоих CLI и идёт в JSON envelope как `orphans: <N>`. probe-security exit code теперь учитывает `orphans > 0`.
- [x] Verify на mass-assignment с боевым sentry spec: banner печатается на stderr, в `--json` режиме подавлен. 11 unit-тестов на shared helpers (`countCleanupFailures`, `printMutationBanner`).
- [ ] ~~Verify tests→probes→tests без 404~~ — runtime-тест, требует живого Sentry. Recovery-путь `zond discover --api X` зафиксирован в banner и в post-run hint.
<!-- SECTION:ACCEPTANCE:END -->

## Implementation notes

<!-- SECTION:NOTES:BEGIN -->
- `src/core/probe/shared.ts`: новые exports `printMutationBanner(name, vars, {quiet})` (stderr-only) и `countCleanupFailures(verdicts)` (404 = success).
- `src/cli/commands/probe-mass-assignment.ts` + `probe-security.ts`: интеграция banner + orphan-counter. `probe-security` ранее имел собственный фильтр `cleanup?.error` — заменено на shared (уравняли семантику с mass-assignment, и теперь 404 правильно не учитывается).
- Banner подавляется в `--json` (envelope уже несёт warnings) и `--dry-run` (security — нет live-вызовов). Только stderr — не ломает CI-output, не пушит в digest.
- ephemeral-режим (`--isolated`) — выделено в TASK-264, как было запланировано.
<!-- SECTION:NOTES:END -->
