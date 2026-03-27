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
   For more detail:
   ```bash
   zond db diagnose <run-id> --verbose --json     # all failure examples, not grouped
   zond db run <run-id> --status 403 --json       # only 403 responses
   zond db run <run-id> --method POST --json      # only POST requests
   ```
3. Check `agent_directive` first — if present in the output, follow it literally before anything else.
4. For each failure, act based on `recommended_action`:
   - `report_backend_bug` → **STOP iterating.** Server returned 5xx. Do NOT change `expect: status`. Report the issue to the user with the `response_body`.
   - `fix_auth_config` → Check `.env.yaml` tokens. Do NOT rewrite test logic.
   - `fix_test_logic` → Fix path, request body, or assertions in the YAML file.
   - `fix_network_config` → Check `base_url` in `.env.yaml`.
5. Fix only tests with `fix_test_logic` action. Re-run after fixes:
   ```bash
   zond run <path> --safe --json
   ```
6. If `summary.api_errors > 0` — stop and report: list affected tests with their `response_body`.
