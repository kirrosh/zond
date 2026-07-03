---
id: ARV-267
title: 'zond coverage --scope both: cache spec/fixtures between dual loads'
status: To Do
assignee: []
created_date: '2026-05-17 11:44'
updated_date: '2026-05-18 13:02'
labels:
  - coverage
  - perf
  - defer-post-m-23
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

ARV-265 made `zond coverage` (default `--scope both`) call `loadCoverage()` twice — once for test-coverage, once for audit-coverage. Each load re-reads `spec.json`, `.api-fixtures.yaml`, `.env.yaml` and re-runs the matrix engine. The only difference between the two loads is the `run_kind` filter on `runs` — everything else is identical.

For the github 1184-endpoint spec this is ~50-100ms duplicated work. Sub-perceptible today; could be noticeable on Kubernetes-class specs (~3000 endpoints) or in CI loops.

## Goal

Single spec/fixtures/env read per `coverage` invocation. Matrix engine runs twice with different result sets, not twice over the entire pipeline.

## Approach options

- Refactor `loadCoverage` to expose two seams: `prepareCoverageInputs(api)` → `{ endpoints, fixturesAffected, envVars, ephemeralEndpoints }` and `buildScopedMatrix(inputs, scope)` → matrix.
- Or: introduce a `{ scopes: ['test', 'audit'] }` option that returns both matrices in one call.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `coverage --scope both` does exactly one read of spec.json + .api-fixtures.yaml + .env.yaml
- [ ] #2 No behavioural change in test/audit metric values
- [ ] #3 Existing single-scope callers (server, report.ts) unaffected
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
