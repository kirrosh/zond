---
id: ARV-255
title: 'pivot: spec-lint mass downgrade + separate ''zond lint'' mode'
status: Done
assignee: []
created_date: '2026-05-15 07:04'
updated_date: '2026-05-15 09:41'
labels:
  - m-21
  - pivot
  - spec-lint
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

854 spec-lint issues включая 132 HIGH (additionalProperties отсутствует и т.п.) — это и есть "волк! волк!" в отчёте. После такого отчёта команда теряет доверие к инструменту.

## Цель

Spec-lint — отдельный workflow для maintainer\u0027ов спеки. Полезен, но не должен инфлировать severity в security/audit отчёте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все spec-lint findings (additionalProperties: false missing, examples missing, descriptions missing, naming style, etc.) принудительно LOW/INFO. Никаких HIGH на статике YAML.
- [x] #2 Создан отдельный режим 'zond lint' (или 'zond check spec --lint') который выпускает spec-lint findings в свою категорию hygiene.
- [x] #3 Основной 'zond audit' / 'zond probe' / 'zond checks run' отчёт spec-lint findings НЕ показывает по умолчанию (только под --include-hygiene или явный --lint флаг).
- [x] #4 На GitHub spec (текущие 854 issues / 132 HIGH) после изменения: 0 HIGH в основном отчёте; вся spec-lint hygiene доступна через 'zond lint' отдельно.
- [x] #5 Skill zond-checks.md обновлён: spec-lint описан как отдельный workflow, не часть security audit.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Spec-lint severity capped at LOW/INFO and surfaced via dedicated 'zond lint' top-level command. DEFAULT_SEVERITY rewritten: structural violations (A1/A2/B1/B7 — format mismatch, missing path-param format, missing response schema) → LOW; style/documentation gaps (A3-A6, B2-B6, B8-B9 — additionalProperties, naming, examples, descriptions) → INFO. No rule emits HIGH/MEDIUM anymore. User override via --rule R=high|medium silently caps to LOW in normaliseSetting() — spec-lint can never escape the LOW/INFO cap. Exit-code gating removed: lint never gates CI by default; --strict opts back into non-zero exit when any issue lands. New top-level 'zond lint' command at src/cli/commands/check.ts (registerLint), aliases 'check spec' through a shared defineCheckSpec helper. zond.md skill rewritten to describe spec-lint as separate hygiene workflow. AC#3 already satisfied — 'zond audit' / 'zond probe' / 'zond checks run' don't compose lint output. 8-test regression at tests/core/lint-severity-cap.test.ts locks the cap. Two existing lint tests + lint-spec-acceptance integration test updated to expect LOW where they expected HIGH.
<!-- SECTION:FINAL_SUMMARY:END -->
