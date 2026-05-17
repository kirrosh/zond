---
id: ARV-236
title: 'run --safe: отдельный bucket ''skipped: token_scope'' для 401/403 баз'
status: Done
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-17 05:44'
labels:
  - feedback-loop
  - api-github
  - m-16
  - polish-m-22
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-2 / run): failure-class now recognises 401/403 where the test expected 2xx and classifies as env_issue with reason 'token_scope: ...' (failure-class.ts). Negative-probes deliberately expecting 4xx still classify normally. Coverage + db diagnose already filter by failure_class — no change needed there.
<!-- SECTION:NOTES:END -->
