---
id: ARV-401
title: 'Context7 onboarding: submit + claim + verification + snippet-density в docs'
status: In Progress
assignee: []
created_date: '2026-07-09 14:45'
updated_date: '2026-07-10 06:58'
labels:
  - m-27
dependencies:
  - ARV-393
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Самый управляемый discovery-канал: библиотеку добавляет кто угодно, ранжирование частично открыто (name similarity, description relevance, Code Snippet count, verified-приоритет). context7.json уже в корне (включая rules — они инжектятся в контекст чужого агента).

Шаги: submit через context7.com/add-library → claim → manual verification (авто-пороги 250+ stars не пройдём) → официальный GitHub Action для refresh на push → нарастить плотность fenced code-blocks в docs/*.md (явный ранжирующий сигнал).

См. backlog/docs/agentic-discovery-mcp-report.md §1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 kirrosh/zond в индексе Context7, resolve-library-id находит zond
- [ ] #2 Library claimed + подана заявка на manual verification
- [ ] #3 Context7 refresh GitHub Action в CI
- [ ] #4 docs/*.md прогнаны на snippet-density: каждая страница несёт рабочие fenced-примеры
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Submit выполнен 2026-07-09, индекс живой: context7.com/kirrosh/zond — 118 snippets, 7,901 tokens, Trust Score 5.4. Осталось: claim + manual verification, GitHub Action refresh, snippet-density pass по docs/*.md.

Trust-профиль владельца дозаполнен (2026-07-10): bio с упоминанием zond, blog → репо zond, профильный README kirrosh/kirrosh опубликован. Осталось из задачи: claim + manual verification на context7.com, GitHub Action refresh, snippet-density в docs.
<!-- SECTION:NOTES:END -->
