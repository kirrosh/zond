---
id: ARV-411
title: >-
  safe scan can execute persisted mutating suites via zond run (mutation on real
  account)
status: Done
assignee: []
created_date: '2026-07-10 08:25'
updated_date: '2026-07-10 08:49'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SD2 из github run#1 (m-28), SAFETY. /zond-scan step 8 гонял весь tests/ dir; safe-ветка предполагала что step 3 перегенерил GET-only, но tests/ держал full-CRUD suites (persisted, generated_at 2026-05-14). Ничто перед zond run не проверяло методы → на реальном аккаунте были бы live POST/PUT/DELETE. FIX (skill-level, ~/.claude/commands/zond-scan.md step 8): safe-mode ассертит GET-only перед zond run (grep POST/PUT/PATCH/DELETE как YAML-ключи; >0 → SKIP с инструкцией). Проверено: 483 мут-шага на github/tests → SKIP; GET-only dir → 0 → run идёт. Follow-up (defense-in-depth, не срочно): enforced 'zond run --safe' флаг в движке, чтобы гард не зависел от следования скиллу.
<!-- SECTION:DESCRIPTION:END -->
