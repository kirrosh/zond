---
id: ARV-414
title: >-
  zond run: retry_until spins for minutes on never-created resources instead of
  fail-fast (+ no artifact on unresolved-var abort)
status: To Do
assignee: []
created_date: '2026-07-10 09:46'
labels:
  - m-28
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MF1 из vercel run#2 (m-28). При 15 unresolved fixture-vars в 9 suites 'zond run' завис 14+ мин в retry-loop'ах delete-verify по ресурсам, которых нет, и НЕ записал output-файл. Два саб-бага: (a) retry_until по never-created id крутится минутами вместо fail-fast на unresolved-var; (b) нет artifact при undefined-var abort (аналог ARV-357 который про empty-dir, тут — unresolved vars). Fix: fail-fast если path-var не резолвится до запроса; всегда писать --output даже при abort. Связано: ARV-357 (Done, empty-dir case).
<!-- SECTION:DESCRIPTION:END -->
