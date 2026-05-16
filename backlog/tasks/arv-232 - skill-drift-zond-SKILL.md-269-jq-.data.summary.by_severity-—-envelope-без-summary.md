---
id: ARV-232
title: >-
  skill drift: zond/SKILL.md:269 jq .data.summary.by_severity — envelope без
  summary
status: Done
assignee: []
created_date: '2026-05-14 10:41'
updated_date: '2026-05-16 07:38'
labels:
  - feedback-loop
  - api-github
  - m-16
  - skill-drift
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F3/SD2, class quirk+stale-example
Repro: zond check spec --api github --json | jq '.data.summary.by_severity' → null
Expected: skill (.claude/skills/zond/SKILL.md:269) рекомендует jq .data.summary.by_severity — должен быть summary aggregate.
Actual: реальный envelope .data.issues[] (flat) без .data.summary / .data.bySeverity. jq возвращает null.
Effect: агент-фолловер skill'а ломается на этой команде; пришлось писать group_by(.severity)|map(...) вручную.
Fix options: (a) обновить skill пример на актуальный shape; (b) добавить summary в envelope CheckSpec команды. (a) дешевле.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log (check-spec-01.json)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Skill template src/cli/commands/init/templates/skills/zond.md:267 jq pattern matches actual envelope shape (.data.stats with severity counts)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed in validation-sprint 2026-05-16. Verified: src/cli/commands/init/templates/skills/zond.md:285 уже использует .data.stats; устаревший .data.summary.by_severity больше нигде в skills не встречается. AC #1 (skill jq matches actual envelope) выполнен. Stale In Progress — забыли пометить Done.
<!-- SECTION:NOTES:END -->
