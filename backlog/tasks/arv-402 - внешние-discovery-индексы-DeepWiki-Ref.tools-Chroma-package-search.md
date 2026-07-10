---
id: ARV-402
title: 'внешние discovery-индексы: DeepWiki + Ref.tools + Chroma package-search'
status: To Do
assignee: []
created_date: '2026-07-09 14:45'
updated_date: '2026-07-10 07:14'
labels:
  - m-27
dependencies:
  - ARV-400
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Три канала с внешней подачей, один заход:
1. DeepWiki: открыть deepwiki.com/kirrosh/zond (индексация по запросу, бесплатно) + бейдж в README (auto-refresh — вторичные источники).
2. Ref.tools: письмо на hello@ref.tools с просьбой добавить доки zond.
3. Chroma package-search: PR в chroma-core/package-search (npm/@kirrosh/zond/config.json + index.json); риск отказа по popularity — не discovery, но даёт агентам чтение кода без установки.

См. backlog/docs/agentic-discovery-mcp-report.md §2, §3, §7.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 deepwiki.com/kirrosh/zond проиндексирован, бейдж в README
- [ ] #2 Письмо в Ref.tools отправлено
- [ ] #3 PR в chroma-core/package-search открыт (или зафиксирован мотивированный отказ)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DeepWiki проиндексирован 2026-07-09 (по 488dde2), бейдж добавлен в README (+ npm-бейдж). Осталось: письмо hello@ref.tools, PR в chroma-core/package-search.

Хвост после закрытия m-27: письмо hello@ref.tools + PR в chroma-core/package-search. DeepWiki-часть закрыта (AC#1 ✓).
<!-- SECTION:NOTES:END -->
