---
id: ARV-427
title: >-
  zond run --safe filters at HTTP-method (step) level, not suite level —
  silently drops write steps with no 'skipped' accounting, inflating failure
  counts
status: Done
assignee: []
created_date: '2026-07-10 13:52'
updated_date: '2026-07-10 14:29'
labels:
  - m-28
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry run#4 (m-28). 'zond generate's own output classifies whole suite files as Safe (read-only) vs Unsafe (writes/deletes — hit live API), listing crud-*.yaml and smoke-*-unsafe.yaml under Unsafe. Reasonably read as 'these files are excluded under --safe'. In practice 'zond run <dir> --safe' runs GET steps from EVERY suite including the ones generate calls Unsafe, and simply drops (does not execute, does not report as skipped) the POST/PUT/DELETE steps within them. Observed on members-crud.yaml: 6 steps defined (list, create+capture, get, update, delete[always:true], verify-deleted[always:true]); the JSON report for the --safe run shows only 3 steps total (list, get, verify-deleted) — the create/update/delete steps vanish from the report entirely, with no skip-count/skip-reason attached, unlike a fully-blocked suite (e.g. detectors-crud, which correctly prints '2 step(s) skipped — required fixture {{detector_id}} is empty'). Consequence: the surviving get/verify-deleted steps then run against WHATEVER the fixture held before this run (since the capture step that would have refreshed it never ran under --safe) and fail their assertions (get expected fresh-create fields, verify-deleted expected 404, got 200) — structurally guaranteed failures that have nothing to do with a real API regression, inflating this run's failure count (19 failed) with pure --safe-mode artifacts and briefly causing genuine confusion about whether a live DELETE had fired against a real resource (it had not — confirmed no mutation occurred). Fix: (1) --safe should emit an explicit skip entry for each write step it drops, matching the fully-blocked-suite UX; (2) assertions that depend on a dropped step's outcome should also skip rather than fail, or generate should mark such trailing assertions as safe-mode-conditional. Evidence: zond-runs/sentry-run4-20260710/raw/, apis/sentry/tests/crud-members.yaml.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: --safe now MARKS write steps with skip_reason (runner emits an explicit skip) instead of deleting them from the suite silently. Verified live on Sentry: POST step shows 'skip → --safe mode: skipped POST write step'. Combined with ARV-428, dependent get/verify steps also skip cleanly. Test added.
<!-- SECTION:NOTES:END -->
