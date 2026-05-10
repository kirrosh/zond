---
id: ARV-15
title: 'generate: separate safe vs unsafe output, warn on POST/PUT'
status: Done
assignee: []
created_date: '2026-05-10 07:13'
updated_date: '2026-05-10 07:58'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F4, class quirk
Repro: zond generate --api resend --output apis/resend/tests --include 'path:^/[^{]+$'
Expected: warning что included POST/PUT-эндпоинты будут создавать ресурсы; явное разделение в выводе (safe vs unsafe).
Actual: вывод сваливает *-positive.yaml и *-unsafe.yaml вперемешку без подсказки, что unsafe — реальные POST'ы на бой (отправка email на api.resend.com).
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->
