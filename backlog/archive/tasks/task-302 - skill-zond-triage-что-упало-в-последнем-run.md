---
id: TASK-302
title: 'skill: zond-triage (что упало в последнем run)'
status: Done
assignee: []
created_date: '2026-05-09 07:00'
updated_date: '2026-05-09 09:00'
labels:
  - skills
  - agent-first
  - m-13
milestone: m-13
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Самый востребованный use-case (audit-and-consolidation §6, vector-3 §7): агент получает 'расскажи что упало в последнем run', читает recommended_action из db diagnose / lint-spec / probe findings и выдаёт actionable summary. Размер ~200 строк. Зависит от унификации recommended_action enum (см. соседнюю задачу).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 skills/zond-triage.md создан
- [x] #2 Скилл использует recommended_action enum, не LLM-классификацию
- [x] #3 Cover скилла: db diagnose, lint-spec, probe-* findings
- [x] #4 skills/zond.md ссылается на zond-triage в navigator-секции
<!-- AC:END -->
