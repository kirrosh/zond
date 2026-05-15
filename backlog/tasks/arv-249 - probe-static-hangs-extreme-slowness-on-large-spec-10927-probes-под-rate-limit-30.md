---
id: ARV-249
title: >-
  probe static: hangs/extreme slowness on large spec (10927 probes под
  rate-limit 30)
status: To Do
assignee: []
created_date: '2026-05-15 05:42'
labels:
  - feedback-loop
  - api-github
  - m-16
  - perf
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 05 (inline user note), finding F20, class likely_bug/perf
Repro: zond probe static --api github (GitHub OpenAPI ~1183 endpoints → ~10927 generated probe cases) под --rate-limit 30 → процесс пришлось убить.
Expected: либо batched/parallel execution, либо progress reporting + ETA, либо early-exit при превышении timeout, либо разумные значения по дефолту.
Actual: процесс висит без видимого progress, пришлось SIGKILL.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-05.log (partial, до kill)
Связано с ARV-227 (checks run --phase coverage extreme slowness on large specs).
<!-- SECTION:DESCRIPTION:END -->
