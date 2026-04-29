---
name: zond
description: |
  End-to-end API testing with zond — generate tests from an OpenAPI spec, run them,
  diagnose failures, and hunt for typical backend bugs via probe suites. Use when
  asked to: test an API, cover endpoints, raise coverage, find bugs, diagnose
  failed runs, fix failing tests, debug 4xx/5xx, run probes, sync tests after a
  spec change, set up API test infrastructure. Activates on: openapi.json,
  openapi.yaml, swagger.json, .api-catalog.yaml, "test this API", "cover this
  spec", "tests are failing", "diagnose run", "find bugs", "probe", "5xx",
  "negative input".
allowed-tools: [Read, Write, Bash(zond *), Bash(bunx zond *)]
---

# zond — API Coverage, Diagnosis & Bug Hunting

CLI-only skill. zond is invoked directly via shell. Run `zond --version` first;
if missing, install via `curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh`.

For multi-step user journeys / fixture creation through the API, hand off to
`zond-scenarios` instead — that is a different concern.

## Critical rules (always-on)

- **NEVER** open OpenAPI/Swagger files with Read/cat/grep — use `zond describe`,
  `zond catalog`, or the generated `.api-catalog.yaml`.
- **NEVER** use curl/wget — use `zond request <method> <url>`.
- **NEVER** write test YAML from scratch — start with `zond generate`, then edit failures.
- **NEVER** hardcode tokens — `apis/<name>/.env.yaml` (auto-gitignored), reference as `{{auth_token}}`.
- **`--safe` enforces GET-only** — required for first-pass smoke against unknown envs.
- **`recommended_action: report_backend_bug` (5xx) → STOP**. Do NOT modify
  `expect: status` to make the test pass. Surface the bug to the user with the
  request/response excerpt.
- **5xx in any run is a bug candidate** — never edit assertions to mask it.
- For multi-suite tag filters always include the setup tag: `--tag crud,setup`.
- Captures are file-scoped — pass auth across suites via a `setup: true` suite.
- Re-run after each fix with `--safe --json`; do not batch many edits without verifying.

## Entry points (skip phases when the request is narrow)

| User asked... | Start at phase | Skip |
|---|---|---|
| "cover this API", "raise coverage", "test this spec" | 1 (Discover) | — |
| "find bugs", "probe this API", "test for 5xx" | 1 then 5 (Probes) | — |
| "tests are failing", "diagnose run X", "fix failures" | 4 (Diagnose) | 1–3 |
| "the run after my fix" | 3.x (Run) → 4 (Diagnose) | 1–2 |

## Phase 1 — Discover

```bash
# Workspace + register API (idempotent)
zond init --with-spec <spec> --name <name> [--base-url <url>]
zond use <name>

# Endpoint discovery (do NOT read the raw spec)
zond catalog <spec> --output apis/<name>/tests   # writes .api-catalog.yaml
zond describe <spec> --compact                   # quick overview
zond guide <spec> --tests-dir apis/<name>/tests  # uncovered + suggestions
```

## Phase 2 — Generate

```bash
zond generate <spec> --output apis/<name>/tests              # all
zond generate <spec> --output apis/<name>/tests --tag <tag>  # by spec tag
zond generate <spec> --output apis/<name>/tests --uncovered-only
zond validate apis/<name>/tests                              # YAML lint
```

`generate` fills bodies with `{{$randomString}}`. Format-strict APIs will reject
many of these — that is a **test-fix**, not a backend bug. See phase 4 for the fix flow.

## Phase 3 — Run (sanity → smoke → full)

```bash
# 3.1 Sanity gate — must pass before broad runs
zond run apis/<name>/tests --tag sanity --json

# 3.2 Smoke (GET-only)
zond run apis/<name>/tests --safe --json

# 3.3 Full CRUD — only after setup-token capture works
zond run apis/<name>/tests --tag crud,setup --json
```

## Phase 4 — Diagnose failures

```bash
zond db runs --limit 5 --json                # find failed runId
zond db diagnose <run-id> --json             # full DiagnoseResult (grouped by root_cause)
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

### 4a. Fixing 4xx caused by stub generators

When `recommended_action: fix_test_logic` and the body is rejected on format
(400/422 with a field name and an "expected ..." message):

1. Read the failure body: `zond db run <id> --status 422 --json`.
2. **First pass** — swap `{{$randomString}}` for the matching typed generator:

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
   business constraint), drop to a hardcoded literal that satisfies the contract
   (e.g. `"https://example.com"`, `"info@example.com"`, `"2026-01-01T00:00:00Z"`).
4. **Dependent IDs** (`audience_id`, `topic_id`, anything that must reference an
   existing resource) — generators cannot help. Either capture the ID from a
   prior `create_*` step in the same suite, or move that creation into a
   `setup: true` suite and reference the captured variable.

## Phase 5 — Proactive bug hunting (probes)

Run on a passing API to surface latent bugs.

```bash
# Negative-input — 5xx on malformed bodies/query/path
zond probe-validation <spec> --output apis/<name>/probes/validation
zond run apis/<name>/probes/validation --json

# Undeclared HTTP methods — 5xx or unexpected 2xx on methods not in spec
zond probe-methods <spec> --output apis/<name>/probes/methods
zond run apis/<name>/probes/methods --json

# Mass-assignment — privilege escalation via extra fields (live, needs --env)
# Hits POST endpoints with is_admin/role/account_id/... and verifies via follow-up GET.
# Emits a markdown digest (HIGH/MED/LOW/OK) + optional regression YAML for CI.
zond probe-mass-assignment <spec> --env apis/<name>/.env.yaml \
  --output apis/<name>/probes/mass-assignment-digest.md \
  --emit-tests apis/<name>/probes/mass-assignment

# Triage
zond db diagnose <run-id> --json
```

Typical findings:
- **5xx on null / empty / oversized body** → missing input validation.
- **5xx on wrong type** (string for int, etc.) → unguarded coercion.
- **2xx on undeclared method** → contract drift (spec lies, or method is unprotected).
- **5xx on missing required field** → uncaught NPE on the server.
- **`is_admin: true` / `role: "admin"` echoed in response** → mass-assignment vulnerability (HIGH from `probe-mass-assignment`).

Filter probe scope when an API is large:
```bash
zond probe-validation <spec> --tag <spec-tag> --max-per-endpoint 20
zond probe-methods <spec> --tag <spec-tag>
zond probe-mass-assignment <spec> --env <env> --tag <spec-tag>
```

## Phase 6 — Coverage report & spec drift

```bash
zond coverage --api <name> --fail-on-coverage 80
zond coverage --api <name> --run-id <id>          # per-run breakdown
zond sync <spec> --tests apis/<name>/tests        # detect new/removed endpoints
```

## Auth / environments

- Tokens go in `apis/<name>/.env.yaml` (auto-gitignored), referenced as `{{auth_token}}`.
- Login-flow tokens: a `setup: true` suite captures into vars that propagate to later
  suites in the same run. See `apis/<name>/tests/setup.yaml` examples emitted by `zond generate`.
- `zond run --env <name>` loads `.env.<name>.yaml` from the API directory.

## When to hand off to `zond-scenarios`

- The user asks for a multi-step user journey, business flow, or fixture creation
  through the API (login → create cart → checkout → cleanup).
- A failing run's root cause requires a hand-written multi-step suite that
  `zond generate` cannot express.

For YAML format (assertions, generators, captures, `always: true` cleanup,
`setup: true` propagation), see `ZOND.md` at the repo root or `zond run --help`.
