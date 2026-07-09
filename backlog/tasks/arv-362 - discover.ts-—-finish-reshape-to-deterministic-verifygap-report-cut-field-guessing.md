---
id: ARV-362
title: >-
  discover.ts — finish reshape to deterministic verify+gap-report, cut
  field-guessing
status: Done
assignee: []
created_date: '2026-07-08 07:13'
updated_date: '2026-07-08 07:46'
labels:
  - m-25
  - cleanup
  - zond-core
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
m-24 Tier 3 reshape недоделан: discover.ts вырос до 1422L, idFromItem (ARV-334) выпилен, но угадывание полей ещё живёт (preferredFieldFromVar:53, pickFieldFromObject:98, extractFirstField+preferredFieldFromVar:755, ?? "id" fallback). Довести до чистого детерминированного контракта: verify (TASK-281) + gap-report наружу, никакого угадывания слота — вместо guess репортим gap.

LITMUS: выбор поля под {{var}} — суждение (что такое owner) → агенту/annotation; discover эмитит только "вот пустой/протухший var, заполни". Deterministic verify+report → в zond.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 preferredFieldFromVar/pickFieldFromObject удалены или сведены к report-gap (не write-guess)
- [ ] #2 discover без auto-fill: только --verify + gap-report, суживается по LOC
- [ ] #3 существующие contract/skill-тесты зелёные, zond.md обновлён под новую форму discover
<!-- AC:END -->
