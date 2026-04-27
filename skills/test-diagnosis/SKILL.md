---
name: test-diagnosis
description: |
  Diagnose API test failures. Use when: tests failed, need to understand why,
  fix failing tests, debug API responses.
allowed-tools: [Read, Write, Bash(zond *)]
---

# Diagnose Test Failures

Thin orchestrator. Full workflow in MCP resources.

## Resources to fetch
- `zond://workflow/diagnosis` — full step-by-step diagnosis workflow
- `zond://run/{id}/diagnosis` — markdown digest for a specific run id

## MCP tools
- `zond_db_runs` — list recent runs (find the failed `runId`)
- `zond_diagnose` — full DiagnoseResult (json) for a `runId`
- `zond_db_run` — filter results within a run (`--status 403`, `--method POST`)

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

For full workflow and recommended_action semantics, fetch `zond://workflow/diagnosis`.
