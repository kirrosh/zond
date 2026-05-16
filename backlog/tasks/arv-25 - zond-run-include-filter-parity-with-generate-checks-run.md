---
id: ARV-25
title: zond run --include filter (parity with generate/checks run)
status: Done
assignee: []
created_date: '2026-05-10 08:21'
updated_date: '2026-05-10 08:25'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 05, finding F1, class missing-feature
Repro: zond run apis/resend/tests --tag positive --include 'path:^/emails' → error: unknown option '--include'
Expected: zond run accepts the same --include/--exclude predicate (path/method/tag/operation-id) as generate and checks run, OR help text explicitly says the filter is generate/checks-only and points to --tag.
Actual: тестеру приходится либо генерить отдельную директорию с generate --include, либо хардкодить путь — обе альтернативы неудобны.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-05.log (block 'broader run: positive + crud …')
<!-- SECTION:DESCRIPTION:END -->
