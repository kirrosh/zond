---
name: zond-diagnose
description: |
  Diagnose API test failures and hunt for typical backend bugs with zond probes.
  Use when: tests failed, need to understand why, fix failing tests, debug 4xx/5xx,
  find validation bugs, find 5xx-on-bad-input, find undeclared HTTP methods,
  proactive bug hunting on a working API. Activates on: "tests are failing",
  "diagnose run", "find bugs", "probe", "5xx", "negative input".
allowed-tools: [Read, Write, Bash(zond *), Bash(bunx zond *)]
---

# zond — Failure Diagnosis & Bug Hunting

CLI-only skill. Two modes:
1. **Diagnose** existing failed run → fix tests OR report backend bug.
2. **Hunt** for typical bugs proactively via probe suites (negative input, undeclared methods).

## Critical rules
- **Always check `agent_directive` first** — if present in DiagnoseResult, follow it literally.
- **`recommended_action: report_backend_bug` (5xx) → STOP**. Do NOT modify
  `expect: status` to make the test pass. Surface the backend bug to the user with
  the request/response excerpt.
- Only edit YAML for failures with `recommended_action: fix_test_logic`.
- Probe-generated 5xx is a **bug candidate**, not a flaky test.
- Re-run after each fix with `--safe --json`; do not batch-fix without verifying.

## Mode 1 — diagnose a failed run
```bash
zond db runs --limit 5 --json                # find the failed runId
zond db diagnose <run-id> --json             # full DiagnoseResult (grouped by root cause)
zond db run <id> --status 500 --json         # filter results within a run
zond db run <id> --method POST --json
zond db compare <idA> <idB> --json           # regression diff between runs
```

DiagnoseResult guide:
- `agent_directive` — literal next step. Do exactly that.
- `recommended_action`:
  - `fix_test_logic` → edit the YAML (assertion, generator, capture).
  - `report_backend_bug` → STOP, report to user.
  - `update_expectation` → only if the user confirms the new contract is correct.
- `root_cause` groups identical failures so one fix covers many cases.

## Fixing 4xx caused by stub generators (`$randomString` everywhere)

`zond generate` fills bodies with `{{$randomString}}` for every field. APIs that
strictly validate formats (email, FQDN, UUID, IPv4, ISO date) will reject these
with **400/422** — `recommended_action: fix_test_logic`. This is **not** a backend
bug. Fix flow:

1. Read the failure body (`zond db run <id> --status 422 --json`) — it usually
   names the offending field and the expected format.
2. **First pass** — swap `{{$randomString}}` for the matching generator:

   | API expects   | Use                  |
   |---------------|----------------------|
   | email         | `{{$randomEmail}}`   |
   | hostname/FQDN | `{{$randomFqdn}}`    |
   | URL           | `{{$randomUrl}}`     |
   | IPv4          | `{{$randomIpv4}}`    |
   | UUID          | `{{$uuid}}`          |
   | integer       | `{{$randomInt}}`     |
   | ISO date      | `{{$randomIsoDate}}` |
   | date          | `{{$randomDate}}`    |
   | person name   | `{{$randomName}}`    |

3. **Second pass** — if a typed generator still fails (regex too strict, enum,
   business constraint), drop to a hardcoded literal that is known to satisfy
   the contract (e.g. `"https://example.com"`, `"info@example.com"`,
   `"2026-01-01T00:00:00Z"`).
4. **Dependent IDs** (`audience_id`, `topic_id`, anything that must reference an
   existing resource) — generators cannot help. Either capture the ID from a
   prior `create_*` step in the same suite, or move that creation into a
   `setup: true` suite and reference the captured variable.

After each fix re-run `zond run <path> --safe --json` and re-diagnose; do not
batch many edits without verifying.

## Mode 2 — proactive bug hunting (probes)
Run on a passing API to surface latent bugs.

```bash
# Negative-input bugs (5xx on malformed bodies/query/path)
zond probe-validation <spec> --output apis/<name>/probes/validation
zond run apis/<name>/probes/validation --json

# Undeclared HTTP methods (5xx or unexpected 2xx on methods not in spec)
zond probe-methods <spec> --output apis/<name>/probes/methods
zond run apis/<name>/probes/methods --json

# Then triage:
zond db diagnose <run-id> --json
```

Typical findings:
- **5xx on null / empty / oversized body** → missing input validation.
- **5xx on wrong type** (string for int, etc.) → unguarded coercion.
- **2xx on undeclared method** (e.g. PATCH on a GET-only endpoint) → contract drift.
- **5xx on missing required field** → uncaught NPE on the server.

Filter probe scope when an API is large:
```bash
zond probe-validation <spec> --tag <spec-tag> --max-per-endpoint 20
zond probe-methods <spec> --tag <spec-tag>
```

## Quickstart
```bash
zond run <tests-dir> --safe --json
zond db diagnose <run-id> --json
# fix YAML if recommended_action=fix_test_logic; otherwise report bug
zond run <tests-dir> --safe --json           # verify
```

## When to hand off
- Need to add tests for uncovered endpoints → `zond-coverage`.
- The bug is in a multi-step user flow that needs hand-written YAML → `zond-scenarios`.

For `recommended_action` semantics and YAML editing patterns, see `ZOND.md` at the repo root.
