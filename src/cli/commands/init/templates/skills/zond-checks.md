---
name: zond-checks
description: |
  Schemathesis-style depth checks for an API — conformance + security
  probes that go beyond YAML smoke tests. Use when the user asks for:
  "deep audit", "find spec drift", "test edge cases", "boundary value
  coverage", "find security bugs", "broken auth check", "use-after-free",
  "SARIF for code scanning", "GitHub Code Scanning report", "stateful
  invariants", "cross-call drift", "idempotency replay", "pagination
  consistency", "lifecycle state machine". For a full generated test
  pipeline + scenarios + audit chain, hand off to `zond`. For triage
  of a failing run, use `zond-triage`.
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
| "is GET returning what POST accepted?", "cross-call drift" | `... --check cross_call_references` (m-20) |
| "does the API honor Idempotency-Key?", "two-POST replay" | `... --check idempotency_replay` (m-20) |
| "are paginated lists consistent?", "duplicates across cursor pages" | `... --check pagination_invariants` (m-20) |
| "does cancel/archive land the resource in the declared state?", "state-machine" | `... --check lifecycle_transitions` (m-20) |
| "do captured webhook events match spec.webhooks shape?" | `zond probe webhooks --event-log events.jsonl` (m-20) — recipe: docs/recipes/webhook-receiver.md |
| "schemathesis-style strict mode" | `... --strict-405 --strict-401` (m-18) |
| "SARIF for GitHub Code Scanning" | `... --report sarif --output zond.sarif` |
| "stream findings to a pipeline" | `... --report ndjson \| jq -c '.'` |
| "scan large API faster" | `... --workers auto` (or `--workers 8`) |

### Strict-mode флаги (m-18)

- **`--strict-405`** — `unsupported_method` принимает только 405 (вместо
  pragmatic 401/403/404/405). Mirror schemathesis V4 default. Включай
  когда target — backend, где политика «undeclared method → 405»
  обязательна (RFC 9110 compliance).
- **`--strict-401`** — `ignored_auth` no-auth/bogus_auth требует ровно 401
  (вместо любого 4xx). Включай для проверки точности auth-rejection policy.

Pragmatic режим (default) — реалистичный для production API'ев где gateway
часто возвращает 404 на undeclared method или 403 на missing auth.

## Iron rules

- **NEVER hand-roll these checks in YAML.** The catalog encodes
  schemathesis V4 semantics 1-to-1 — replicating them in YAML drifts
  silently. `zond checks run` is the single source of truth.
- **NEVER run `--check stateful` without prior `api annotate` review.**
  m-20 stateful checks (cross_call_references, idempotency_replay,
  pagination_invariants, lifecycle_transitions) read `.api-resources.local.yaml`
  for per-API quirks (custom pagination param, non-standard lifecycle
  field, write-only ignore_fields). Defaults catch the obvious; running
  on defaults alone misses API-specific drift. See **Phase pre-0** below.
- **NEVER ignore `--bootstrap-cleanup-failed`.** Stateful security
  checks (`ignored_auth`, `use_after_free`, `ensure_resource_availability`)
  produce false positives on stale data. If the previous run's
  cleanup failed, pass the flag — they skip with a warning instead.
- **Auth headers are auto-derived from `--api <name>` `.env.yaml`**
  (`auth_token` → `Authorization: Bearer …`, `api_key` → `X-API-Key`).
  Add explicit ones with `--auth-header 'Name: value'` (repeatable).

## Phase pre-0 — Annotation (mandatory for `--check stateful`)

> **Heads-up for `pagination_invariants`:** only cursor-style pagination
> is implemented in this milestone (`cursor`/`next`-token responses).
> APIs with `type: page` / `type: offset` (GitHub, Linear, Resend, …)
> are accepted by `annotate apply` but the check short-circuits with
> "type not implemented" — annotating page-based pagination has **no
> runtime effect**, skip the dump+apply step for those resources.

m-20 stateful checks rely on per-resource config in
`.api-resources.local.yaml` (overlay that survives `refresh-api`).
`zond api annotate` is the canonical authoring path: zond emits raw
spec slices, **agent (you) writes the YAML**, zond validates and
applies. **zond itself does NOT call any LLM** — agent is the LLM, zond
is the dumb-tool.

Six dump aspects (one per check class):

```bash
zond api annotate dump --api <name> --seed-bodies   > /tmp/seed.json
zond api annotate dump --api <name> --readback      > /tmp/readback.json
zond api annotate dump --api <name> --idempotency   > /tmp/idem.json
zond api annotate dump --api <name> --pagination    > /tmp/pag.json
zond api annotate dump --api <name> --lifecycle     > /tmp/life.json
zond api annotate dump --api <name> --resources     > /tmp/orphans.json  # optional: new CRUD resources from orphans
```

Restrict scope with `--only r1,r2,r3` on any dump.

Agent reads each dump and writes a YAML response file (top-level list
of entries — see per-check schemas below for the block shape).
Optional `rationale` and `confidence: high|medium|low` per entry help
future review.

Apply — dry-run first (renders diff + conflicts), then `--yes` to write:

```bash
zond api annotate apply --api <name> --readback --input /tmp/readback.yaml         # dry-run
zond api annotate apply --api <name> --readback --input /tmp/readback.yaml --yes   # write
zond api annotate apply --api <name> --readback --input /tmp/readback.yaml --yes --force  # overwrite conflicts
```

Conflicts: when an existing field already has a value, apply keeps
existing by default (renders `! field: (conflict — kept existing; pass
--yes to overwrite)`). Pass `--force` to overwrite.

**Recommended pre-stateful sweep on a new API:**

```bash
zond api annotate dump --api <name> --seed-bodies > /tmp/seed.json    # for prepare-fixtures --seed
zond api annotate dump --api <name> --readback    > /tmp/readback.json # for cross_call_references
zond api annotate dump --api <name> --pagination  > /tmp/pag.json     # for pagination_invariants
zond api annotate dump --api <name> --lifecycle   > /tmp/life.json    # for lifecycle_transitions
zond api annotate dump --api <name> --idempotency > /tmp/idem.json    # for idempotency_replay
# … agent generates YAML files for each …
zond api annotate apply --api <name> --seed-bodies --input /tmp/seed.yaml --yes
zond api annotate apply --api <name> --readback   --input /tmp/readback.yaml --yes
zond api annotate apply --api <name> --pagination --input /tmp/pag.yaml --yes
zond api annotate apply --api <name> --lifecycle  --input /tmp/life.yaml --yes
zond api annotate apply --api <name> --idempotency --input /tmp/idem.yaml --yes
```

Each block's YAML format is documented under the per-check section below.

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

### Spec-level rollup (ARV-60)

When a single spec-level gap manifests on many operations (`401 not
declared in spec` × 83 sites; `no JSON Schema on this response branch` ×
all skipped cases; `use_after_free` ran 0 cases because there's no
DELETE+GET pair in the spec), the runner emits a single `spec_finding`
instead of N per-op rows. Threshold: ≥80% of the check's applicable
operations sharing one root cause.

Each `spec_finding` has:

| Field | Meaning |
|---|---|
| `kind` | `status_drift` / `missing_declaration` / `no_detector` / `other` |
| `reason` | One-line root cause statement |
| `fix_hint` | Actionable next step (spec edit / tolerate flag / annotate command) |
| `affected_operations` | Operations covered (empty for skip/no-detector clusters) |
| `count` / `applicable` | Cluster size + the population it was measured against |

Triage spec_findings first — they collapse 1×N noise into one decision.
Per-op findings still live in `data.findings`; `--verbose` brings the
full unaggregated list back to stdout. SARIF + JSON envelope always
carry both layers.

```bash
zond checks run --api myapi --json | jq '.data.spec_findings'
zond checks run --api myapi --report ndjson | jq -c 'select(.type == "spec_finding")'
```

## Output formats

```bash
zond checks run --api myapi --json                 # one envelope: findings[] + spec_findings[] + summary
zond checks run --api myapi --report sarif --output zond.sarif
                                                    # SARIF v2.1.0 for github/codeql-action/upload-sarif@v3
zond checks run --api myapi --report ndjson | jq -c '.'   # streaming events: check_start | check_result | finding | spec_finding | summary
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

# Cross-call POST→GET drift only (m-20, single CRUD-chain check per resource)
zond checks run --api stripe --check cross_call_references
```

## Cross-call drift (m-20 ARV-169)

`cross_call_references` — POST resource → GET resource, diff write-shape
vs read-shape. Surfaces fields the server silently dropped:

- **state_not_persisted** — POST 2xx echoed the field, GET dropped it.
  HIGH-signal: server lied about persisting state.
- **write_only** — POST accepted, GET dropped. Spec-declared write-only
  fields (passwords, etc.) are auto-filtered.

Tunable per-resource in `apis/<name>/.api-resources.yaml` (или
`.api-resources.local.yaml` overlay):

```yaml
resources:
  - resource: customer
    # … existing fields …
    readback_diff:
      ignore_fields: [metadata, livemode]      # API-quirks, suppress
      write_to_read_map:
        tax_id_data: tax_ids                   # write-shape → read-shape
```

Defaults already filter timestamps (`created_at`, `updated_at`), envelope
fields (`object`, `_links`), and ETag. Per-API quirks need a yaml line.
Authored either by hand or via the `zond api annotate dump --readback` →
agent → `apply` flow (see **Phase pre-0** above). zond emits the
write+read endpoint slice; agent decides `ignore_fields` /
`write_to_read_map` and writes the YAML; zond validates + writes to
`.api-resources.local.yaml`.

## Idempotency replay (m-20 ARV-170)

`idempotency_replay` — two POSTs with the same `Idempotency-Key` header.
Server must (a) return the same resource id and (b) bit-identical response
bodies (modulo timestamps / request-id / etag).

- **duplicate_resource** — ids differ → server ignored the key. HIGH.
- **non_bit_identical** — same id but bodies drift on non-ignored fields
  → replay isn't truly idempotent. Surfaced in the same HIGH finding via
  `evidence.kind`.

Two ways to opt-in per resource:

1. Spec declares `Idempotency-Key` as a header parameter on the create
   endpoint → auto-detected, runs with defaults.
2. `.api-resources.local.yaml` block (preferred — documents intent +
   lets you tune the ignore list). Author via Phase pre-0
   `annotate dump --idempotency` → agent → `apply`:

```yaml
resources:
  - resource: charge
    # … existing fields …
    idempotency:
      header: Idempotency-Key            # default; override for non-standard names
      scope: endpoint                    # informational; `endpoint` | `global`
      ignore_response_fields:            # added on top of timestamp/request_id baseline
        - retry_after
```

Anti-FP: 429/409 on the 2nd POST → skip with cleanup. No DELETE on the
group → finding still fires, evidence carries `cleanup_warning`.

## Pagination invariants (m-20 ARV-171)

`pagination_invariants` — fetch two consecutive cursor pages and assert
the contract holds:

- **duplicate_items** — an item id appears on both page A and page B
  (off-by-one / cursor stops one short). HIGH-signal.
- **has_more_inconsistent** — page A said `has_more=true`, but page B is
  empty and doesn't flip to `has_more=false`. Surfaces broken end-of-list
  signalling.
- **partial_page_with_has_more** — page A returns fewer items than the
  requested limit *yet* advertises `has_more=true`. Means the cursor is
  prematurely truncating responses.

Cursor-style only in this milestone (Stripe / GitHub / Resend / Linear
pattern). `page` / `offset` / `token` declarations parse but the check
short-circuits with a "type not implemented" reason so the yaml block
stays a stable schema.

Auto-detect: if the list endpoint declares `starting_after` / `cursor` /
`after` / `page_token` as a query parameter, the check runs with
defaults (`cursor_field=id`, `items_field=data|items|results`,
`has_more_field=has_more`, `limit=2`).

Per-resource yaml override (author via Phase pre-0
`annotate dump --pagination` → agent → `apply`):

```yaml
resources:
  - resource: customer
    # … existing fields …
    pagination:
      type: cursor                   # only cursor supported today
      cursor_param: starting_after   # Stripe-style; "after" / "cursor" / "page_token" also work
      cursor_field: id               # field on each item that feeds the next cursor
      has_more_field: has_more       # response field that flips on end-of-list
      limit_param: limit             # query param for page size
      default_limit: 2               # probe page size — small on purpose
      items_field: data              # array container (falls back to items / results / value)
```

## Lifecycle transitions (m-20 ARV-172)

`lifecycle_transitions` — declare a state machine in
`.api-resources.yaml`, the check creates a resource and walks the
named actions, asserting:

- **undeclared_state** — observed state isn't in declared `states[]`.
- **wrong_expected_state** — action landed the resource in a state other
  than its declared `expected_state`.
- **forbidden_transition** — observed (from, to) isn't in declared
  transitions graph.
- **state_regression_on_replay** — invoking the action a second time
  drifted state instead of staying idempotent.
- **double_action_5xx** — replay 5xx'd. Idempotent actions should 4xx
  or 2xx, never crash.
- **action_rejected** — first-call non-2xx (server-side gating). Not a
  contract bug per se, surfaced as INCONCLUSIVE-class info.

Manifest validation runs at yaml load (catches cycles, unreachable
states, missing terminal, actions referencing undeclared states)
before any HTTP call goes out.

Author via Phase pre-0 `annotate dump --lifecycle` → agent → `apply`.
The dump emits action-endpoint candidates (POST `/{resource}/{id}/cancel`,
PATCH `/{resource}/{id}/status` etc.); agent decides the state machine
graph.

```yaml
resources:
  - resource: subscription
    # … existing fields …
    lifecycle:
      field: status
      states: [pending, active, cancelled]
      transitions:
        - from: pending
          to: [active, cancelled]
        - from: active
          to: [cancelled]
        - from: cancelled
          to: []                     # terminal
      actions:
        cancel:
          endpoint: POST /v1/subscriptions/{id}/cancel
          expected_state: cancelled
```

Action endpoints accept the `{id}` placeholder (replaced with the
captured create-id) or `{<idParam>}`. Body-less actions are the common
case; provide `body:` only for actions that demand a request payload.
