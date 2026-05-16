---
id: TASK-264
title: 'probes: --isolated режим (namespace zond-probe-{run-id}/{idx} + auto-teardown)'
status: Done
assignee: []
created_date: '2026-05-08 15:00'
updated_date: '2026-05-08 15:10'
labels:
  - feedback-loop
  - probes
  - safety
dependencies:
  - TASK-259
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions "Что съедает время" #2 (продолжение TASK-259).

TASK-259 предлагает warning + recovery. Этот таск — конкретное «правильное» решение: дать `--isolated` режим, при котором probes не трогают seeded fixtures вообще.

Поведение:
- В `--isolated` каждый mutation-probe генерирует свой namespace `zond-probe-{run-id}-{idx}` (или короткий UUID).
- POST-resources создаются в этом namespace, slug/name/team-id префиксуются.
- После probe-run — automatic teardown (DELETE по captured-id из POST-response). Зависит от TASK-256 (capture в JSON-envelope).
- Если teardown failed → запись в `api-bugs-NN.md` + exit-summary `N orphans, manual cleanup needed`.

Альтернатива/комбинация: `--dry-run --emit-tests` (уже есть) — но `dry-run` не делает live-classification, поэтому не равноценен. Можно сделать `--dry-run-live` промежуточный режим: шлёт безопасные методы (GET/HEAD), а mutation-call'ы только classify по spec'у.

Impact: разблокирует workflow «tests-run → probes-run → tests-run на тех же fixtures» без 404 на seeded ID.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 `zond probe ... --isolated` существует и документирован.
- [ ] #2 Все mutation-resources создаются в namespace `zond-probe-{run-id}-{idx}`; namespace prefix на slug/name fields.
- [ ] #3 Auto-teardown после probe-run; teardown-failures репортятся, не сваливают весь run.
- [ ] #4 Seeded fixtures (`.env.yaml`) не мутируются в `--isolated`.
- [ ] #5 Verify: `zond run apis/sentry/tests` → `zond probe mass-assignment --api sentry --isolated` → `zond run apis/sentry/tests` снова → нет 404 на seeded `monitor_id_or_slug`/`alert_rule_id`.
- [ ] #6 (опционально) `--isolated` становится дефолтом для mass-assignment; warning при явном `--no-isolated`.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->
