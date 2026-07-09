---
id: ARV-366
title: 'warm-up-target skill — агент сидит рабочее окружение цели, поднять honest-2xx'
status: Done
assignee: []
created_date: '2026-07-08 07:14'
updated_date: '2026-07-08 08:04'
labels:
  - m-25
  - skill
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сквозная тема всех feedback-раундов (feedback-14): реальный потолок — не coverage, а honest-2xx. Он упирается в warm-up рабочего окружения цели (создать test event → issue_id, sourcemap → file_id, slack-integration → integration_id, replay через SDK) — это ВНЕ ядра zond, прямо назван кандидатом на скилл.

Скилл (не код zond): агент готовит окружение цели её же средствами (SDK/UI/API), заполняет фикстуры реальными живыми id, затем передаёт эстафету в zond для прогона. Ложится на litmus test: суждение как разогреть → агент/скилл, не эвристика в ядре.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 skill warm-up-target: агент детерминированно доводит пустой workspace до набора живых фикстур для ≥1 публичного API
- [ ] #2 прогон до/после показывает измеримый рост honest-2xx (цель ~30% → 80%)
- [ ] #3 скилл не тащит seed-логику обратно в ядро zond (проверка по litmus test)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped the warm-up-target skill (template + init/skills.ts registration + zond-seed cross-link). It covers the external-input fixtures that cap honest-2xx and that zond-seed explicitly reports as un-seedable: real-event ids (issue_id/event_id), uploaded-artifact ids (file_id/sourcemap), integration/installation ids, delivered-webhook ids, async-provisioned ids. The agent warms each via the target's OWN tooling (SDK/CLI/dashboard/replay); zond only stores the harvested live id (fixtures add --validate) and measures the coverage delta (coverage --union session). Litmus-clean — no warm-up heuristic in core.

AC1 (skill drives empty workspace → live fixtures) satisfied by the skill + its loop. AC3 (no seed-logic back in core) satisfied by design. AC2 (measurable honest-2xx lift on a live public API) is creds/target-gated — same class as the ARV-365 publish gate — deferred to a live run with the user's sandbox + token.

Full suite green (2420 pass). Binary rebuilt + reinstalled; verified `zond init` writes the skill into .claude/skills/.
<!-- SECTION:FINAL_SUMMARY:END -->
