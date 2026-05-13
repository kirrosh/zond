---
id: ARV-178
title: 'docs: recipes/quicktype + recipes/interactsh + skill update for m-18'
status: Done
assignee: []
created_date: '2026-05-12 13:27'
updated_date: '2026-05-13 11:34'
labels:
  - m-18
  - docs
  - skill
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Блок E m-18. Зафиксировать новые workflow как воспроизводимые рецепты
и обновить skill-шаблоны.

## docs/recipes/quicktype.md

Copy-paste-ready на Sentry. Содержит:
- установку quicktype/genson
- команды `zond run` для накопления 2xx samples (~50 endpoint)
- `zond schema-from-runs` + `zond refresh-api --merge-schema`
- ожидаемая дельта response_schema_conformance findings
- anti-FP regression check через m-15 fixture pack

## docs/recipes/interactsh.md

Copy-paste-ready. Содержит:
- запуск interactsh-client локально
- `zond probe security --oob-server` пример
- интерпретация результатов (correlation-id, timeout)

## Skill update

Apply memory `feedback_update_skills_per_feature`. Обновить
`src/cli/commands/init/templates/skills/zond-base.md` (Phase 4 — SSRF
workflow) и `zond.md` (Phase 2.5 — schema-from-runs для depth-lift).

## Зависимости

- ARV-175/176 — quicktype recipe не пишется до них
- ARV-177 — interactsh recipe не пишется до него
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docs/recipes/quicktype.md запускается вслепую новым tester за <15 минут на Sentry
- [ ] #2 docs/recipes/interactsh.md запускается вслепую за <15 минут (включая поднятие interactsh-client)
- [x] #3 init-template skills обновлены, /zond-fb-tester SD-pass не находит drift
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Частичное закрытие согласно m-18-decision §E. Skill update сделан: zond-checks.md в 9c95113 (--strict-405/-401 в matrix + блок 'Strict-mode флаги'), zond.md добавлена строка 'schemathesis-style strict mode' → zond-checks. AC#1/#2 (recipes quicktype/interactsh) — не пишутся, т.к. ARV-175/176 deferred до m-21, ARV-177 deferred до m-19. Recipes откроются при реализации соответствующих фич.
<!-- SECTION:FINAL_SUMMARY:END -->
