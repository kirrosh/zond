---
id: TASK-212
title: 'ZOND.md: задокументировать тег unsafe и --safe фильтр'
status: Done
assignee: []
created_date: '2026-05-07 14:09'
updated_date: '2026-05-07 14:19'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F4, class missing-feature (docs gap)
Repro: zond generate создаёт сьюты с тегом [smoke] [unsafe] (POST/DELETE без idempotency): smoke-emails-unsafe, smoke-api-keys-unsafe, smoke-domains-unsafe, etc.
Expected: ZOND.md описывает семантику unsafe-тега (что означает, как фильтровать, почему отдельно от crud), плюс пояснение --safe / --exclude-tag unsafe
Actual: ZOND.md не упоминает unsafe. Пользователь не знает что --tag smoke включает unsafe, а --safe их отсекает. Safe test workflow неочевиден.
Log: /tmp/zond-fb/resend/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->
