---
id: ARV-236
title: 'run --safe: отдельный bucket ''skipped: token_scope'' для 401/403 баз'
status: To Do
assignee: []
created_date: '2026-05-14 11:16'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F9, class quirk
Repro: zond run apis/github/tests --safe --report json (с PAT-узким scope)
Expected: --safe должен по-разному обрабатывать 401/403 (env_issue, не fail) — отдельный bucket skipped: token_scope в JSON-репорте, чтобы coverage и triage не считали их fail-ом.
Actual: status=fail в JSON; zond coverage вычитает в coveredButNon2xx, но fixer/триаджу нужно вручную фильтровать.
Log: ~/Projects/zond-test/.fb-loop/rounds/run-02-smoke.json
<!-- SECTION:DESCRIPTION:END -->
