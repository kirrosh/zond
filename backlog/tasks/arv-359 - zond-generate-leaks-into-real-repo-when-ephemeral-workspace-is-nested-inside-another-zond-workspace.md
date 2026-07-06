---
id: ARV-359
title: >-
  zond generate leaks into real repo when ephemeral workspace is nested inside
  another zond workspace
status: To Do
assignee: []
created_date: '2026-07-06 18:17'
labels:
  - zond-bug
  - workspace
  - isolation
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: run petstore/20260706-210328 (live). Setup exported ZOND_WORKSPACE=<runDir>/workspace and cd'd there, but 'zond generate --api petstore --output apis/petstore/tests' wrote 10 suites + .env.yaml into the REAL repo /Users/kirrotech/Projects/zond/apis/petstore/ (15-generate.log:16 '⚠ Created .../Projects/zond/apis/petstore/.env.yaml'). The ephemeral workspace apis/petstore/tests stayed EMPTY → every later 'zond run apis/petstore/tests' hit 'No test files found', exit 0, no report → cascaded into B2 self-compare + empty coverage. The whole CRUD/compare/pass-coverage portion of the audit was voided, and the run polluted the user's working repo with an untracked apis/petstore/ (I deleted it).

ROOT-CAUSE HYPOTHESIS: the ephemeral workspace lives at zond-runs/<slug>/<ts>/workspace, i.e. NESTED inside the real repo (itself a zond workspace). generate's workspace-root resolution walked UP past ZOND_WORKSPACE and matched the outer real repo. Notably the earlier Stripe run (same out=./zond-runs) did NOT leak; the difference is the path case — Stripe runDir was /Users/kirrotech/Projects/zond (primary cwd), Petstore was /Users/kirrotech/projects/zond (the lowercase additional working dir). On a case-insensitive macOS FS, a case-mismatched cwd likely broke the case-sensitive 'is WS inside ZOND_WORKSPACE' prefix check, so walk-up escaped to the real repo.

LITMUS: deterministic isolation fix, belongs in zond. FIX DIRECTIONS: (a) zond core — ZOND_WORKSPACE must be a HARD ceiling for workspace walk-up (never resolve --output / workspace root above it), and path comparisons must canonicalize case on case-insensitive FS; (b) workflow mitigation — default 'out' to an out-of-repo temp dir (e.g. $TMPDIR/zond-audit) so the ephemeral WS is never nested under a real workspace. Do both: (a) is the real fix, (b) is defense-in-depth.
<!-- SECTION:DESCRIPTION:END -->
