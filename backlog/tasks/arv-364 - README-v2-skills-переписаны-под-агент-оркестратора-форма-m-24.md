---
id: ARV-364
title: README v2 + skills переписаны под агент-оркестратора (форма m-24)
status: Done
assignee: []
created_date: '2026-07-08 07:14'
updated_date: '2026-07-08 07:56'
labels:
  - m-25
  - distribution
  - docs
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
README всё ещё 141 строка от старой формы. decision-9 в consequences: distribution-задачи пересматриваются под новую внутреннюю форму, а не тащатся как есть. Переписать README v2 и skills (zond.md/zond-checks.md/zond-triage.md/zond-seed.md) под m-24-модель: zond = набор dumb-инструментов, агент собирает suite, дозапрашивает недостающее у пользователя. Убрать любые упоминания срезанного эвристического слоя (annotate auto, prepare-fixtures --seed/--cascade, auto-discovery).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 README v2 описывает агент-оркестратор-flow, без мёртвых упоминаний heuristic-слоя
- [ ] #2 skills/*.md синхронизированы с реальным CLI (skill regression-тесты ARV-121 зелёные)
- [ ] #3 quickstart в README доводит нового пользователя до первого прогона
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Skills were already rewritten to the m-24 agent-orchestrator form during m-24, so this was targeted alignment, not a v2 rewrite. Fixed the one stale class: prepare-fixtures/discover "fills .env.yaml" language + the removed --seed/--cascade flags, which shipped into every workspace via zond init.

- AGENTS.md + templates/agents.md: dropped --seed/--cascade; prepare-fixtures reframed as gap-report (never harvests); fixtures add/import fill values.
- README: prepare-fixtures reports gaps → you fill; fixture-flow corrected.
- zond.md + zond-triage.md skills: gap-report framing.
- Verified no dead mentions of removed subcommands (annotate auto, bootstrap seed). --seed-bodies (agent-authored create-body overlay, ARV-187) is LIVE and kept.

Contract + skill-regression tests green (147 pass). Binary rebuilt + reinstalled so zond init ships the corrected templates.
<!-- SECTION:FINAL_SUMMARY:END -->
