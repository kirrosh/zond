---
id: ARV-227
title: 'checks run --phase coverage: extreme slowness on large specs (R17/F32)'
status: To Do
assignee: []
created_date: '2026-05-14 10:12'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 17, finding F32, class likely_bug / perf regression, severity HIGH.

Repro:
  time zond checks run --api github --phase coverage \
    --include 'method:GET' \
    --include 'path:^/(zen|meta|emojis|octocat|rate_limit|versions|users/octocat|repos/octocat/Hello-World|gitignore/templates|licenses)$' \
    --report ndjson --output /tmp/r17.ndjson
  # 8 min → SIGTERM; only 2/16 checks fired (status_code_conformance + unsupported_method)
  # 2890 check_result events ≈ 6 req/s, no progress output

Expected: 10 GET-paths × 16 checks × ~30 cases per coverage = ~4800 cases should complete in 1-2 minutes (req-rate ~5/s + GitHub IO).

Actual: 8+ min, no progress reporter, no --max-requests cap, only 2/16 checks even started. Most likely culprits: schema-compile per case (same family as F18 ARV-214), or serial enumeration without batching.

Investigation hints:
  - profile runChecks in src/core/checks/runner.ts on the dereferenced github spec
  - check whether createSchemaValidator is invoked per-case rather than once
  - consider adding a --max-requests / --timeout-per-check cap

Log: see feedback-17.md F32. Likely shares root with F18 (ARV-214) — investigate together.
<!-- SECTION:DESCRIPTION:END -->
