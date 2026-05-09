---
id: TASK-292
title: 'skills: 5 missing iron rules in zond.md and scenarios.md'
status: To Do
assignee: []
created_date: '2026-05-09 06:59'
labels:
  - skills
  - docs
  - m-13
milestone: m-13
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Добавить 5 правил из audit-and-consolidation.md §6: (1) NEVER destructive ops без --dry-run на shared/prod org; (2) NEVER report cleanup-failure as API bug; (3) NEVER share artifacts без --redact-identity; (4) MUST timeout bootstrap cascade (default 8 passes); (5) MUST run doctor --missing-only first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 5 правил добавлены в iron-rules секции skills/zond.md и/или skills/scenarios.md
- [ ] #2 Каждое правило с одной строкой 'почему'
- [ ] #3 Тесты на skills (если есть smoke) проходят
<!-- AC:END -->
