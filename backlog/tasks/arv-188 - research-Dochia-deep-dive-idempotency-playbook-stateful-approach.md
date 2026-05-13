---
id: ARV-188
title: 'research: Dochia deep-dive (idempotency playbook + stateful approach)'
status: Done
assignee: []
created_date: '2026-05-13 11:54'
updated_date: '2026-05-13 12:07'
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
- [x] #1 В m-20-validation.md обновлена строка Dochia с покрытием 5 invariant'ов
- [x] #2 1-параграф impressions добавлен
- [x] #3 Если найден pattern к копированию — открыта новая ARV-задача
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deep-dive завершён. Ключевые выводы:

1. Dochia казался closest competitor — оказался **не closest**. Реальный stateful surface = 1 trivial playbook (DELETE→GET→404). Idempotency blog post — thought-leadership marketing, не product feature.

2. m-20 направление подтверждено как greenfield. Ни один из 5 invariant'ов у них не реализован.

3. Категорическое преимущество zond — agent-augmented LLM-pass (`zond api annotate`). У Dochia ноль LLM usage, явная ставка на deterministic-only. Agent у них снаружи.

4. Два pattern'а к копированию открыты отдельными задачами:
   - ARV-189: x-zond-* OpenAPI extensions (skip/enable rules per endpoint в spec'е)
   - ARV-190: Dynamic value functions в yaml (#(uuid), #(today), #(todayPlus))

5. Watch items:
   - Premium 'Test Execution DSL' (может быть stateful sequencing language)
   - OpenAPI links usage в их internals

Полный report в backlog/notes/m-20-validation.md §«Dochia deep-dive».
<!-- SECTION:FINAL_SUMMARY:END -->
