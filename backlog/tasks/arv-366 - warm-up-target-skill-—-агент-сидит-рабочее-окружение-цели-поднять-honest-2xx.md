---
id: ARV-366
title: 'warm-up-target skill — агент сидит рабочее окружение цели, поднять honest-2xx'
status: In Progress
assignee: []
created_date: '2026-07-08 07:14'
updated_date: '2026-07-08 07:59'
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
