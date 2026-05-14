---
id: ARV-214
title: 'run --validate-schema: hangs >15min on large dereferenced specs (R13/F18)'
status: To Do
assignee: []
created_date: '2026-05-14 09:25'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 13, finding F18, class likely_bug / perf regression, severity HIGH.

Repro:
  zond run apis/github/tests/_smoke_user.yaml --validate-schema \
    --spec apis/github/spec.json --rate-limit 5 --sequential \
    --no-fail-on-failures --report json
  # hangs >15 min, 0 bytes in stdout until SIGKILL
  # Without --validate-schema: ~30 seconds for the same suite.

Expected: schema-validate on dereferenced ~14 MiB spec.json (github) should run in seconds per step (validation of a single response body).

Actual: something between requests is extremely expensive. Suspect: re-dereference per step, or AJV schema-compile without caching across steps.

Impact: HIGH — cuts off schema-drift validation on any large API (github, kubernetes, large stripe). Without it, contract-drift detection collapses on the most interesting specs.

Investigation hints:
  - check createSchemaValidator caching in src/core/validate-schema.ts (or similar)
  - AJV compile is O(n) on schema size; if compiled per-step on 14 MiB spec, that's the culprit.

Log: ps showed zond run pid alive 16 min, output file 0 bytes.
<!-- SECTION:DESCRIPTION:END -->
