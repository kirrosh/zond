---
name: test-diagnosis
description: |
  Diagnose API test failures. Use when: tests failed, need to understand why,
  fix failing tests, debug API responses.
allowed-tools: [Read, Write, Bash(zond *)]
---

# Diagnose Test Failures

CLI-only skill.

## CLI commands
- `zond db runs --limit 5 --json` — list recent runs (find the failed `runId`)
- `zond db diagnose <run-id> --json` — full DiagnoseResult
- `zond db run <id> [--status 403] [--method POST] --json` — filter results within a run

## Critical rules
- **Always check `agent_directive` first** — if present, follow it literally
- **`recommended_action: report_backend_bug` (5xx) → STOP**, do NOT modify `expect: status` — report the backend bug to the user
- Only edit YAML for failures with `recommended_action: fix_test_logic`

## Quickstart
```bash
zond db runs --limit 5 --json
zond db diagnose <run-id> --json
# fix → re-run
zond run <path> --safe --json
```

For `recommended_action` semantics and YAML editing patterns, read `ZOND.md`
at the repo root.
