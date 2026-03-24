---
description: Diagnose why API tests failed
allowed-tools: [Read, Bash(zond *)]
argument-hint: [run-id]
---

If $ARGUMENTS provided, use it as run ID.
Otherwise, get latest failed run:
!`zond db runs --limit 3 --json`

Then diagnose using skill test-diagnosis workflow.
