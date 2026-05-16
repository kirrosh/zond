---
id: ARV-28
title: zond coverage --verbose to print not-covered endpoints inline
status: Done
assignee: []
created_date: '2026-05-10 08:27'
updated_date: '2026-05-10 08:29'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 06, finding F3, class ux-papercut
Repro: zond coverage --verbose → 'error: unknown option --verbose'. В смежных командах флаг работает (zond check spec --verbose выводит 181 строку).
Expected: либо coverage --verbose объявлен и печатает not-covered endpoints поимённо, либо --help явно говорит 'use --json для подробностей' (сейчас и --json в help'е не указан).
Actual: --verbose не определён, для деталей надо coverage --json | jq.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-06.log (block 'K. coverage --json or --verbose')
<!-- SECTION:DESCRIPTION:END -->
