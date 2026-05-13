---
id: ARV-188
title: 'research: Dochia deep-dive (idempotency playbook + stateful approach)'
status: To Do
assignee: []
created_date: '2026-05-13 11:54'
labels:
  - m-20
  - research
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dochia — closest competitor zond'у (CLI + OpenAPI + playbooks). Research-pass показал что у них есть idempotency playbook и stateful testing категория. Перед началом m-20 probe'ов — узнать что именно они делают, что можем перенять (или явно отойти от их подхода).

## Что выяснить

- Idempotency playbook: какие assertions, как детектируют idempotent endpoints, как handlят Idempotency-Key header?
- Stateful playbooks: что у них покрыто (cross-call, pagination, lifecycle?), как объявлены?
- YAML/JSON schema их playbook'ов: насколько declarative? auto-detect vs manual?
- LLM usage: используют ли они LLM где-то?
- Pricing/positioning: commercial или OSS? насколько активно develop'ится?

## Источники

- docs.dochia.dev
- blog.dochia.dev/blog/idempotency/
- GitHub их репозитория если есть

## Deliverable

Update backlog/notes/m-20-validation.md §«Конкуренты» с детальной строкой Dochia + 1 параграф impressions. Если найдём ценный pattern — открыть отдельную ARV-задачу с reference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В m-20-validation.md обновлена строка Dochia с покрытием 5 invariant'ов
- [ ] #2 1-параграф impressions добавлен
- [ ] #3 Если найден pattern к копированию — открыта новая ARV-задача
<!-- AC:END -->
