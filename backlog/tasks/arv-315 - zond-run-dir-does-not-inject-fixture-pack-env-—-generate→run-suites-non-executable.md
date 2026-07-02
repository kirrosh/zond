---
id: ARV-315
title: >-
  zond run <dir> does not inject fixture-pack env — generate→run suites
  non-executable
status: Done
assignee: []
created_date: '2026-07-02 15:18'
updated_date: '2026-07-02 15:27'
labels:
  - config-resolution
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CONFIRMED on Stripe live run 20260702-174915 and reproduced standalone. 'zond generate' emits suites referencing {{base_url}}/{{auth_token}}, but 'zond run apis/<api>/tests' fails every step with failure_class=env_issue ('base_url is not configured — URL resolved to {{base_url}}/v1/...'). Verified: fails with --api stripe AND with --env apis/stripe/.env.yaml, even though base_url IS present in .env.yaml. checks/probes resolve the same values fine (they hit api.stripe.com live in the same run) — so run uses a different, broken config-resolution path. Breaks the flagship generate→run loop advertised in README. Downstream: coverage --union session then reports 0% (only counts run-suite hits, all env_issue) despite audit_coverage.reached=59.6% (former report-zond B3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond run apis/<api>/tests --api <api> resolves {{base_url}}/{{auth_token}} from the fixture pack (.env.yaml + .secrets.yaml) like checks/probes do
- [ ] #2 generated suites execute out of the box against a bootstrapped workspace (no manual --var)
- [ ] #3 coverage --union session counts run-suite hits once env resolves (B3 downstream check)
- [ ] #4 regression: a generated suite run resolves vars and produces non-error steps
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: walkUpToWorkspaceRoot did case-sensitive string comparison (startInsideRoot = start.startsWith(root+sep)). On macOS/Windows (case-insensitive FS), process.cwd() casing (…/Projects) vs env-supplied ZOND_WORKSPACE casing (…/projects) differ → startsWith false → env-loading collapses to the single start dir → fixture-pack .env.yaml silently dropped → every {{var}} undefined. Not a 'run uses a different path' bug — checks/probes happened to load env via api-dir helpers that sidestepped walkUp. Fix: canonicalize start + root via realpathSync.native before the comparisons (src/core/parser/variables.ts). Verified: relative searchDir from capital-P cwd now loads 100 keys (was 0). This was the workflow's env_issue cause (depth agent cd $WS lowercase, process.cwd() canonicalizes to capital). typecheck clean, 78 env tests green.
<!-- SECTION:NOTES:END -->
