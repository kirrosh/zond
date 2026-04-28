---
id: TASK-MEDIUM.3
title: probe-validation emits 53 probes that hit HTTP 405 — investigate
status: To Do
assignee: []
created_date: '2026-04-28 08:14'
labels:
  - bug-hunting
  - from-iteration-3
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: iter-3 ran 353 probes from 'zond probe-validation' against Resend; 53 returned HTTP 405 Method Not Allowed. probe-validation should target endpoints declared in the spec, so wrong-method 405s should not happen. Either (a) generator emits a method that the path doesn't actually declare, or (b) probe-methods-style probes leaked into probe-validation output. Repro: see ~/Projects/resend-tests/iterations/iteration-3/run-output/results.json — filter for response.status==405 and inspect the generated YAML files. Suggested triage: jq '.[] | .steps[] | select(.response.status == 405) | {url:.request.url, method:.request.method, suite:.}' on results.json then map back to YAML in iteration-3/generated/. Suggested fix: unit test that asserts every (path,method) emitted by generateNegativeProbes matches an operation in the spec.
<!-- SECTION:DESCRIPTION:END -->
