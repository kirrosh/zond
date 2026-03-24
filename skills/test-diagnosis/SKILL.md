---
name: test-diagnosis
description: |
  Diagnose API test failures. Use when: tests failed, need to understand why,
  fix failing tests, debug API responses.
allowed-tools: [Read, Write, Bash(zond *)]
---

# Diagnose Test Failures

## Recent runs
!`zond db runs --limit 5 --json 2>/dev/null`

## Instructions

1. Get the latest failed run ID from above
2. Run diagnosis:
   ```bash
   zond db diagnose <run-id> --json
   ```
3. For each failure, analyze:
   - **401/403** → auth problem, check .env.yaml tokens
   - **404** → wrong path or missing resource, check test URL
   - **400/422** → request body doesn't match schema, check fields
   - **500** → server bug, DON'T fix the test expectation
   - **Timeout** → server slow or unreachable
4. Fix the TEST (request), not the expected response
5. Re-run after fixes:
   ```bash
   zond run <path> --safe --json
   ```
