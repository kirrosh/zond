---
id: ARV-293
title: README v2 rewrite under decision-8 framing (hygiene scanner for small teams)
status: To Do
assignee: []
created_date: '2026-05-18 11:36'
labels:
  - m-23
  - content
  - distribution
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

README сейчас отражает старый framing («schemathesis killer» / mixed positioning). decision-8 (2026-05-16) зафиксировал: zond = hygiene scanner для команд 5–20 без security-инженера, `60-sec pre-release gate`.

m-23 трек 3 (distribution & content) — без обновлённого README любая community submission (HN, Reddit) приведёт misaligned пользователей.

## Решение

Полный rewrite, structure:
1. **What zond is** — 2 sentences, decision-8 positioning
2. **Quick start** — 3 commands: `zond add-api`, `zond audit --budget quick`, `zond report`
3. **What makes zond different** — `no-evidence-no-high`, 4 categories, anti-FP discipline (vs Schemathesis property-based noise)
4. **When NOT to use** — bounty/exploit testing, GraphQL, browser flows
5. **Examples** — Stripe / GitHub / Linear snippets из corpus
6. **Architecture link** — pointer на strategy.md, никаких философствований в README

Out: marketing fluff, scale promises, AI-buzzwords.

## Acceptance Criteria

- [ ] #1 README.md rewritten (current на feature/validation-sprint-m-22 проверить состояние)
- [ ] #2 3 командных snippet'а работают на чистом setup
- [ ] #3 Linked to: strategy.md, decision-8, public corpus repo
- [ ] #4 Reviewed against decision-8 framing (no scope creep)

## Связано

- m-23 трек 3, decision-8
<!-- SECTION:DESCRIPTION:END -->
