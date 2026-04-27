# Diagnose Test Failures

## Step 1: List recent runs
```bash
zond db runs --limit 5 --json
```
MCP equivalent: call the `zond_db_runs` tool. Either way, pick the latest failed run id.

## Step 2: Run diagnosis
```bash
zond db diagnose <run-id> --json
```
MCP equivalent: call the `zond_diagnose` tool with `runId: <run-id>`. For a pre-rendered markdown digest, read `zond://run/<run-id>/diagnosis`.

For more detail:
```bash
zond db diagnose <run-id> --verbose --json     # all failure examples, not grouped
zond db run <run-id> --status 403 --json       # only 403 responses
zond db run <run-id> --method POST --json      # only POST requests
```

## Step 3: Honor agent_directive
Check `agent_directive` first — if present in the output, follow it literally before anything else.

## Step 4: Act on each failure's recommended_action
- `report_backend_bug` → **STOP iterating.** Server returned 5xx. Do NOT change `expect: status`. Report the issue to the user with the `response_body`.
- `fix_auth_config` → Check `.env.yaml` tokens. Do NOT rewrite test logic.
- `fix_test_logic` → Fix path, request body, or assertions in the YAML file.
- `fix_network_config` → Check `base_url` in `.env.yaml`.

## Step 5: Re-run after fixes
Fix only tests with `fix_test_logic` action. Re-run after fixes:
```bash
zond run <path> --safe --json
```

## Step 6: Stop on backend bugs
If `summary.api_errors > 0` — stop and report: list affected tests with their `response_body`. Do not adjust assertions to make the test pass.
