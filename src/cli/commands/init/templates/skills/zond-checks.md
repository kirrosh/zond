---
name: zond-checks
description: |
  Schemathesis-style depth checks for an API — conformance + security
  probes that go beyond YAML smoke tests. Use when the user asks for:
  "deep audit", "find spec drift", "test edge cases", "boundary value
  coverage", "find security bugs", "broken auth check", "use-after-free",
  "SARIF for code scanning", "GitHub Code Scanning report", or after a
  YAML run passes but they still want depth coverage. For a full
  generated test pipeline, hand off to `zond`. For a single user flow,
  use `zond-scenarios`.
allowed-tools: [Read, Bash(zond *), Bash(bunx zond *), Bash(jq *), Bash(sqlite3 *)]
---

# zond-checks — Depth checks (conformance + security)

CLI-only skill. Use *after* a YAML smoke run passes — depth checks
exercise contract drift, malicious input rejection, broken auth, and
soft-deleted resource leaks against a live API.

The catalog is fixed and self-describing — list it before running so
the user sees what they'll get:

```bash
zond checks list                 # registered checks (id, severity, expected)
zond checks list --json          # same, machine-readable
```

## When to use

| User asks | Run |
|---|---|
| "deep audit", "find edge cases" | `zond checks run --api <name>` |
| "boundary value coverage" | `... --phase coverage` |
| "find security bugs", "broken auth" | `... --check ignored_auth,use_after_free,ensure_resource_availability` |
| "SARIF for GitHub Code Scanning" | `... --report sarif --output zond.sarif` |
| "stream findings to a pipeline" | `... --report ndjson \| jq -c '.'` |
| "scan large API faster" | `... --workers auto` (or `--workers 8`) |

## Iron rules

- **NEVER hand-roll these checks in YAML.** The catalog encodes
  schemathesis V4 semantics 1-to-1 — replicating them in YAML drifts
  silently. `zond checks run` is the single source of truth.
- **NEVER ignore `--bootstrap-cleanup-failed`.** Stateful security
  checks (`ignored_auth`, `use_after_free`, `ensure_resource_availability`)
  produce false positives on stale data. If the previous run's
  cleanup failed, pass the flag — they skip with a warning instead.
- **Auth headers are auto-derived from `--api <name>` `.env.yaml`**
  (`auth_token` → `Authorization: Bearer …`, `api_key` → `X-API-Key`).
  Add explicit ones with `--auth-header 'Name: value'` (repeatable).

## Reading findings

Every finding carries a closed-enum `recommended_action` so the agent
can route without parsing free-form messages:

| `recommended_action` | What to do |
|---|---|
| `report_backend_bug` | Server returned 5xx / accepted invalid auth / leaked deleted resource. File a backend ticket; do not "fix" the test. |
| `fix_spec` | Server's behaviour is reasonable but spec doesn't predict it. Update `apis/<name>/spec.json` (or upstream OpenAPI) and `zond refresh-api`. |
| `tighten_validation` | Server accepted a body that violates the schema. Backend should reject earlier (400/422). |
| `add_required_header` | Spec marked a header `required: true`; server didn't enforce it. Either enforce it or relax the spec. |
| `fix_auth_config` | Auth-related failure. Check `apis/<name>/.env.yaml` (`auth_token`, `api_key`) — never log the value. |
| `fix_network_config` | Transport-level error (timeout / DNS / refused). Verify `base_url` and reachability before re-running. |
| `wontfix_known_limitation` | Known accepted gap. Don't retry, don't file a bug. |

Triage by `recommended_action` first, then by severity. HIGH/CRITICAL
gates exit-code 1; LOW/MEDIUM is informational.

## Output formats

```bash
zond checks run --api myapi --json                 # one envelope: findings[] + summary
zond checks run --api myapi --report sarif --output zond.sarif
                                                    # SARIF v2.1.0 for github/codeql-action/upload-sarif@v3
zond checks run --api myapi --report ndjson | jq -c '.'   # streaming events: check_start, check_result, finding, summary
```

NDJSON event schema is published at `docs/json-schema/ndjson-events.schema.json`
— pipe through `ajv validate` if you build a downstream consumer.

## Scoping a run

Long runs feel sluggish on a 200-endpoint spec. Scope down before
broadening:

```bash
# Filter operations (regex) — same grammar as `zond generate`
zond checks run --api myapi --include 'tag:billing,users' --exclude 'method:DELETE'

# Pick a vector
zond checks run --api myapi --mode positive       # contract verification only
zond checks run --api myapi --mode negative       # malicious-input probes only

# Pick a phase
zond checks run --api myapi --phase coverage      # deterministic boundary values
zond checks run --api myapi --phase examples      # default — one positive + one negative per op
```

`--allow-x00` adds the NUL byte (`\x00`) to string boundaries during
coverage — off by default (some HTTP/JSON stacks panic on it).

## Concurrency

```bash
zond checks run --api myapi --workers auto        # min(cpus, 8); usually right
zond checks run --api myapi --workers 16          # explicit; clamped to 64
zond checks run --api myapi --workers 8 --rate-limit 50
                                                    # 8 workers, global 50 RPS budget
```

Workers parallelize at the *operation* level — cases inside one
operation always run sequentially (CRUD chain ordering must be
preserved). `--rate-limit auto` adapts from `RateLimit-*` response
headers (RFC 9568); use it on rate-limited APIs to avoid bursting.

## "0 findings" doesn't always mean "all green"

The summary one-liner now ends with `(N check outcome(s) skipped: …)`
when probes can't validate (e.g. `response_schema_conformance: no JSON
Schema on this response branch ×2` when probes ran without auth and
got a 4xx that the spec only declares for 2xx). Treat skipped probes
as "not yet exercised", not "passed" — re-run with auth (or via
`zond run --validate-schema`) to actually cover those branches.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | No HIGH/CRITICAL findings (LOW/MEDIUM may be present). |
| 1 | At least one HIGH/CRITICAL finding — gate CI on this. |
| 2 | CLI-input error (bad flag value, unreachable spec, etc.). |

## Common combos

```bash
# Full conformance pass on staging, output SARIF for code scanning
zond checks run --api staging --report sarif --output zond.sarif --workers auto

# Just the security checks (stateful) with explicit auth
zond checks run --api prod \
  --check ignored_auth,use_after_free,ensure_resource_availability \
  --auth-header 'Authorization: Bearer $TOKEN'

# Coverage-phase boundary sweep, NDJSON pipe into a watcher
zond checks run --api dev --phase coverage --report ndjson | \
  jq -c 'select(.type == "finding") | {check, op: .finding.operation, action: .finding.recommended_action}'
```
