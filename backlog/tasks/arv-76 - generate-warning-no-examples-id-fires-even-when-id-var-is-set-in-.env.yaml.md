---
id: ARV-76
title: >-
  generate: warning 'no examples (id)' fires even when id var is set in
  .env.yaml
status: Done
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-11 07:37'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F17, class definitely_bug. Repro: .env.yaml has 'id: ab772e63-...' set; zond generate --api X --include 'path:/audiences.*' --include-deprecated → '⚠ 1 path param(s) have no examples (id) on 2 endpoint(s)'. Expected: when the var matches a path-param name and has a non-empty value, generate should pick it up at generation time (zond run already resolves it). Actual: generate emits the warning, then writes the suite with a placeholder anyway (so run still works — warning is the false positive). Log: ~/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 generate's 'no examples' warning consults apis/<name>/.env.yaml and suppresses params whose env value is set and not a {{placeholder}}
- [x] #2 regression test: warning fires when .env.yaml is empty for the param; silent when filled; still fires for {{$uuid}}-style placeholders
- [x] #3 no behaviour change for generate output itself — only the warning text
<!-- AC:END -->
