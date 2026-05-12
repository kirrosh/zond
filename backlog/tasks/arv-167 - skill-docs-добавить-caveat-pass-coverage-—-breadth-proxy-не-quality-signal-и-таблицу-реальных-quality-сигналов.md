---
id: ARV-167
title: >-
  skill / docs: добавить caveat 'pass-coverage — breadth-proxy, не
  quality-signal' и таблицу реальных quality-сигналов
status: Done
assignee: []
created_date: '2026-05-12 12:46'
updated_date: '2026-05-12 13:11'
labels:
  - feedback-loop
  - skill-drift
  - m-16
  - docs
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09, final session evaluation §3 'Как оцениваю покрытие как метрику в принципе'.

Background: pass-coverage 58% на Stripe (R09) звучит впечатляюще, но достигнут частично через --learn-apply test, который переписал 91 expect.status — это weakening assertions, а не verification. 199 hit-but-fail — generator quality, не API quality.

Skill / docs должны явно сказать:
- pass-coverage — breadth (мы дошли) и health (no 5xx), но НЕ correctness
- hit-coverage > pass-coverage = generator gap, не API bug
- pass ≫ hit невозможно (sanity check)
- Реальные quality-сигналы:
  * checks run --phase coverage HIGH findings (contract drift)
  * probe static --use-synthetic-parents 'missing-validation' (input gaps)
  * tolerated-drifts.yaml diff после --learn (spec drift)
- CI gate recommendation: --fail-on-coverage 50 (hit floor) + HIGH=0 + manual review tolerated-drifts diffs

Где обновить:
- src/cli/commands/init/templates/skills/zond.md — добавить §'How to read coverage'
- docs/coverage.md если есть, или создать
- ARV-160 zond-max-coverage skill — закладывать это с рождения

Effect: правильная mental model — pass-coverage не цель, а одна из метрик; tolerated-drifts.yaml как ревью-артефакт; HIGH-findings как gate.

См. feedback-09.md §3 целиком.
<!-- SECTION:DESCRIPTION:END -->
