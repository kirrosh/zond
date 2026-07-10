---
id: ARV-398
title: >-
  корпус-трек: контент под задачные запросы агентов (сравнения, how-to) +
  консистентная tagline везде
status: To Do
assignee: []
created_date: '2026-07-09 14:18'
updated_date: '2026-07-10 07:14'
labels:
  - m-27
dependencies:
  - ARV-393
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Длинный хвост GEO: чтобы будущие модели знали zond из весов, он должен жить там, откуда собирают датасеты (HN, Reddit, Dev.to, README смежных репо). Контент не "zond release notes", а под задачные запросы: "How coding agents should test APIs", сравнения с Bruno/httpie/Postman CLI/Schemathesis.

Трюк Cassidy Williams: одна tagline дословно везде — LLM связывает источники по консистентным формулировкам. Ongoing-трек, не разовая задача.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 2–3 материала под задачные формулировки опубликованы (Dev.to/HN/Reddit), включая одно сравнение с конкурентами
- [ ] #2 Canonical tagline (ARV-393) дословно в каждом материале
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ongoing-трек, переживает закрытие m-27: opportunistic, вести по мере launch-активностей. Tagline и каналы готовы (393/395/400), материал для первого поста фактически собран в backlog/docs/*.md.
<!-- SECTION:NOTES:END -->
