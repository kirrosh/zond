---
id: ARV-410
title: >-
  zond-scan skill: safe-mode probe passes --emit-tests with --dry-run (rejected
  by zond)
status: Done
assignee: []
created_date: '2026-07-10 08:25'
updated_date: '2026-07-10 08:49'
labels:
  - m-28
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SD1 из github run#1 (m-28). /zond-scan depth-pass step 7 всегда передаёт --emit-tests, а safe-mode ставит --dry-run. После фикса ARV-321 (Done) zond теперь падает громко: 'Error: --emit-tests requires --live' (раньше silently no-op). Safe-mode probe-шаг падает exit 2, inventory теряется. Fix: в safe/dry-run не добавлять --emit-tests (только планирование), --emit-tests только на --live ветке. Связано: ARV-321.
<!-- SECTION:DESCRIPTION:END -->
