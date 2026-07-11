---
id: ARV-406
title: 'case studies: формат + публикация первых двух кейсов'
status: In Progress
assignee: []
created_date: '2026-07-10 07:28'
updated_date: '2026-07-11 07:45'
labels:
  - m-28
dependencies:
  - ARV-404
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Из report-api прогонов — публикуемые кейсы («N находок в API X за 20 минут агентом»): Dev.to/blog, ссылки из README. Canonical tagline дословно в каждом. Поглощает контент-часть ARV-398 на период вехи.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Формат кейса зафиксирован (шаблон)
- [ ] #2 ≥2 кейса опубликованы, tagline дословно, ссылки из README
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Три кейса готовы в docs/case-studies/: github-rest-api.md, vercel-api.md, stripe-lifecycle.md (+ TEMPLATE.md, README-секция Case Studies). Stripe — из deep-dive 2026-07-11: живой money-lifecycle 15/15 (scenarios/invoice-lifecycle.yaml), находка про usd-на-EUR-аккаунте. Deep-dive также дал engine-задачи ARV-430..434 (карта пробелов zond-runs/stripe-run3/gap-map.md). Коммиты 54f7ac7, 1370a9a.
<!-- SECTION:NOTES:END -->
