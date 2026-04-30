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

CLI-only skill. Run `zond --version` first; if missing:
`curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh`.

For multi-step user journeys / fixture creation through the API, hand off to
`zond-scenarios` instead.

## Critical rules (always-on)

- **NEVER** open OpenAPI/Swagger with Read/cat/grep — use `zond describe`,
  `zond catalog`, or `.api-catalog.yaml`.
- **NEVER** use curl/wget — use `zond request <method> <url>`.
- **NEVER** write test YAML from scratch — start with `zond generate`, then edit failures.
- **NEVER** hardcode tokens — put in `apis/<name>/.env.yaml` (auto-gitignored), reference as `{{auth_token}}`.
- **`recommended_action: report_backend_bug` / any 5xx → STOP**. Surface the
  request/response excerpt to the user; do NOT edit `expect:` to mask it.
- `--safe` enforces GET-only — required for first-pass smoke against unknown envs.
- For multi-suite tag filters always include the setup tag: `--tag crud,setup`.
- Re-run after each fix with `--json`; don't batch edits without verifying.

## Entry points (skip phases when the request is narrow)

| User asked... | Start at phase | Skip |
|---|---|---|
| "cover this API", "raise coverage", "test this spec" | 1 (Discover) | — |
| "find bugs", "probe this API", "test for 5xx" | 1 then 5 (Probes) | — |
| "tests are failing", "diagnose run X", "fix failures" | 4 (Diagnose) | 1–3 |
| "the run after my fix" | 3.x (Run) → 4 (Diagnose) | 1–2 |
| "share these results", "case study", "draft an issue" | 7 (Share) | 1–6 |

## Phase 1 — Discover

```bash
zond init --with-spec <spec> --name <name> [--base-url <url>]
zond use <name>
zond catalog <spec> --output apis/<name>/tests   # writes .api-catalog.yaml
zond describe <spec> --compact                   # quick overview
zond guide <spec> --tests-dir apis/<name>/tests  # uncovered + suggestions
```

## Phase 2 — Generate

```bash
zond generate <spec> --output apis/<name>/tests [--tag <tag>] [--uncovered-only]
zond validate apis/<name>/tests
```

`generate` fills bodies with `{{$randomString}}`. Format-strict APIs reject many
of these — that's a **test-fix**, not a backend bug (Phase 4a).

## Phase 2.5 — Fixture pack (real-API pre-flight)

Before *any* CRUD run on a real API, gather **FK ids**, **verified resources**,
and **valid enums** into `apis/<name>/.env.yaml` — generators cannot produce
them, and skipping this costs 5+ fix-iterations. No separate `fixtures.yaml`;
`.env.yaml` already takes arbitrary keys interpolated as `{{var}}`.

```bash
zond request GET /audiences | jq '.data[0].id'
zond request GET /domains   | jq '.data[] | select(.status=="verified") | .id'
```

```yaml
# apis/<name>/.env.yaml — auth + fixtures
base_url: https://api.example.com
auth_token: <secret>
audience_id: "0b141f35-..."
verified_from_email: "onboarding@example.dev"
real_to_email: "delivered@example.dev"
region: "us-east-1"
```

Reference as `{{audience_id}}`, `{{verified_from_email}}`, etc. Skip on mock
servers, `--safe` runs, and specs with no `format:` constraints.

## Phase 3 — Run (sanity → smoke → full)

When you're about to fire several runs in a row (sanity → smoke → CRUD →
probes), group them into one campaign so `/runs` shows one row instead of
N. Run `zond session start --label "<short reason>"` once before the
sweep; every `zond run` in this workspace then auto-inherits the
`session_id`. Close with `zond session end`. Use it for any multi-run
sweep — fixture-pack pass, probe burst, post-deploy check.

```bash
zond session start --label "smoke + probes"                          # group runs
zond run apis/<name>/tests --tag sanity --json                       # 3.1 sanity gate
zond run apis/<name>/tests --safe --json                             # 3.2 smoke (GET-only)
zond run apis/<name>/tests --tag crud,setup --validate-schema --spec <spec> --json  # 3.3 full CRUD
zond session end
```

**Always pass `--validate-schema` for CRUD** — contract drift (date format,
enum drift, extra/missing fields) is invisible without it. Schema violations
land as `schema_violation` root_cause in `zond db diagnose` and are real
backend bugs — treat them like 5xx, do not edit the expectation away.

## Phase 4 — Diagnose failures

```bash
zond db runs --limit 5 --json
zond db diagnose <run-id> --json             # grouped by root_cause
zond db run <id> --status 500 --json
zond db compare <idA> <idB> --json           # regression diff
```

`agent_directive` = literal next step. `recommended_action` ∈
{`fix_test_logic` (edit YAML), `report_backend_bug` (STOP, report),
`update_expectation` (only on user confirmation)}.

### 4a. Fixing 4xx caused by stub generators

When `recommended_action: fix_test_logic` and the body is rejected on format
(400/422 with a field name + "expected ..." message):

1. Read the failure body: `zond db run <id> --status 422 --json`.
2. **Fixture pack first** — if the field is a FK id, verified resource, or
   constrained enum, add it to `.env.yaml` and reference as `{{var}}`
   (Phase 2.5). Generators cannot help here.
3. **Typed generator** — for the rest, swap `{{$randomString}}` for the
   matching format-aware generator (`{{$randomEmail}}`, `{{$randomUrl}}`,
   `{{$uuid}}`, `{{$randomInt}}`, `{{$randomIsoDate}}`, …; full list in
   `zond run --help`).
4. **Hardcoded literal** — if the typed generator still fails (regex too
   strict), drop to a literal that satisfies the contract.
5. **Runtime captures** are for resources the test itself creates (capture
   from a prior `create_*` step or a `setup: true` suite). For *pre-existing*
   FKs, prefer step 2.

## Phase 5 — Proactive bug hunting (probes)

Run on a passing API to surface latent bugs.

```bash
zond probe-validation <spec> --output apis/<name>/probes/validation
zond probe-methods    <spec> --output apis/<name>/probes/methods
zond probe-mass-assignment <spec> --env apis/<name>/.env.yaml \
  --output apis/<name>/probes/mass-assignment-digest.md \
  --emit-tests apis/<name>/probes/mass-assignment

zond run apis/<name>/probes/<class> --json
zond db diagnose <run-id> --json
```

Findings to flag: 5xx on null/empty/wrong-type body (missing validation /
unguarded coercion), 2xx on undeclared method (contract drift), `is_admin: true`
echoed in response (HIGH from `probe-mass-assignment`).

Filter scope on large APIs: `--tag <spec-tag> [--max-per-endpoint 20]`.

### Phase 5.1 — Manual mass-assignment catch-up

`probe-mass-assignment` digest splits findings into HIGH / MED / LOW /
**INCONCLUSIVE**. INCONCLUSIVE = the auto-prober couldn't build a valid body
(same fixture problem as Phase 4a). After the fixture pack is filled, sweep
INCONCLUSIVE with this template — one file per resource:

```yaml
# apis/<name>/probes/mass-assignment/<resource>.yaml
name: ma <resource>
base_url: "{{base_url}}"
headers: { Authorization: "Bearer {{auth_token}}" }
tests:
  - name: create with privileged fields
    POST: /<resource>
    json:
      # …real create body sourced from fixtures…
      name: "ma-test-{{$randomString}}"
      is_admin: true
      role: "admin"
      owner_id: "attacker-{{$uuid}}"
      account_id: "attacker-account"
      created_at: "1970-01-01T00:00:00Z"
    expect:
      status: [200, 201]
      body: { id: { capture: created_id } }
  - name: verify privileged fields not echoed
    GET: /<resource>/{{created_id}}
    expect:
      status: 200
      body:
        is_admin: { not: true }
        role: { not_equals: "admin" }
        owner_id: { not_starts_with: "attacker-" }
  - name: cleanup
    DELETE: /<resource>/{{created_id}}
    always: true
    expect: { status: [200, 202, 204] }
```

If `is_admin: true` survives the round-trip GET → **HIGH**. File via
`zond report case-study` (Phase 7).

### Phase 5.2 — Manual security probes (SSRF, header-injection)

Until first-class commands ship (TASK-59 SSRF / TASK-60 CRLF), use these
templates **only on endpoints whose spec matches the trigger** — running blindly
is noise.

**SSRF — trigger:** POST/PATCH body field named `*url*`, `endpoint`, `webhook`,
`callback`, `redirect_uri`, `image_url`, or `format: uri | url`.

```yaml
tests:
  - name: ssrf <vector>
    POST: /<endpoint>
    json: { url: "<payload>" }
    expect: { status: [400, 422] }     # NOT 2xx, NOT 5xx
```

Payloads to iterate: `http://169.254.169.254/latest/meta-data/` (AWS IMDS),
`http://127.0.0.1:22`, `http://10.0.0.1` (RFC1918), `http://[::1]`,
`file:///etc/passwd`, `gopher://`, `dict://`. Triage: `2xx` = accepted internal
URL; `5xx` = unguarded URL parser; high `duration_ms` on 4xx = server attempted
the connection (timing side-channel).

**CRLF / header-injection — trigger:** body fields `subject`, `from`, `to`,
`cc`, `bcc`, `reply_to`, `headers[]`, `tags[].name`, or any free-text serialised
into outbound mail/HTTP headers.

```yaml
tests:
  - name: CRLF in <field>
    POST: /<endpoint>
    json:
      from: "{{verified_from_email}}"
      to: "{{real_to_email}}"
      subject: "ok\r\nBcc: attacker@evil.example"
      html: "<p>x</p>"
    expect: { status: [400, 422] }
```

Payload variants: `\r\nBcc: ...`, `\nX-Injected: 1`, `%0d%0aBcc:...` (URL-encoded),
`\r\n\r\n<html>` (response-splitting). Triage: `2xx` = accepted at API layer
(filing-worthy even without sink confirmation); `5xx` on `\r\n` = unguarded
serialiser (separate bug).

### Phase 5.3 — Robustness probes (content-type, idempotency)

Universal — no field-name trigger. Apply to 1–2 representative endpoints per
resource; not every endpoint.

**Content-type / shape mismatch** (any JSON POST/PATCH/PUT). Trigger: 5xx where
a hardened parser should reject.

```yaml
tests:
  - name: scalar where object expected
    POST: /<endpoint>
    json: 42
    expect: { status: [400, 422] }            # NOT 5xx
  - name: form-encoded against JSON endpoint
    POST: /<endpoint>
    headers: { Content-Type: "application/x-www-form-urlencoded" }
    form: { name: "x" }
    expect: { status: [400, 415, 422] }
```

Variants expressible today: `json: 42 | [] | null`, form/text-plain headers,
GET with body. Variants requiring **raw-body strings** — truncated JSON,
trailing comma, unquoted keys, BOM, duplicate keys, deeply-nested — not
supported in current zond YAML; cover via `zond request` ad-hoc or wait on
TASK-112.

**Idempotency / double-DELETE** (any DELETE). Trigger: 5xx on second DELETE,
or stale resource still readable.

```yaml
tests:
  - name: create
    POST: /<resource>
    json: { name: "idem-{{$randomString}}" }
    expect: { status: [200, 201], body: { id: { capture: created_id } } }
  - name: first delete
    DELETE: /<resource>/{{created_id}}
    expect: { status: [200, 202, 204] }
  - name: second delete is 404
    DELETE: /<resource>/{{created_id}}
    expect: { status: 404 }
  - name: GET after delete is 404
    GET: /<resource>/{{created_id}}
    expect: { status: 404 }
  - name: subresource action after delete is 404
    POST: /<resource>/{{created_id}}/<subaction>
    expect: { status: 404 }
```

Cancel-style endpoints (`/emails/{id}/cancel`) may legitimately return `200` on
the second call — note as *project decision*, not a bug.

## Phase 6 — Coverage report & spec drift

```bash
zond coverage --api <name> --fail-on-coverage 80
zond coverage --api <name> --run-id <id>          # per-run
zond sync <spec> --tests apis/<name>/tests        # detect spec drift
```

## Phase 7 — Share findings

After a run is in `zond.db`, materialise it as a shareable file:

```bash
zond report export <run-id> -o triage/run-<id>.html         # whole run, single-file HTML
zond report case-study <failure-id>                          # → stdout (pipe to gh issue create --body-file -)
zond report case-study <failure-id> -o draft.md
zond report case-study <failure-id> --json                   # envelope with `markdown`
```

`<run-id>` from `zond db runs`; `<failure-id>` is `results.id` from
`zond db run <run-id>`. **Offer this proactively** after a run surfaces a
`definitely_bug` (5xx, schema violation, mass-assignment 2xx) — skip for
`env_issue` and `quirk`. Case-study fills TL;DR / Context / Spec / Repro /
What happened / Why it matters; missing fields become `<TODO: ...>` placeholders.

## Auth / environments

- `apis/<name>/.env.yaml` is **both** auth and the fixture pack — any key is
  interpolatable as `{{key}}`. Auto-gitignored on `zond init`.
- Login-flow tokens: a `setup: true` suite captures into vars that propagate
  to later suites in the same run.
- `zond run --env <name>` loads `.env.<name>.yaml`. Discovery walks **up to
  workspace root** (zond.config.yml / .zond / apis/ marker), so probes in
  `apis/<name>/probes/<class>/` inherit the API-level env without copying.
  Deeper files override shallower on collisions.

## When to hand off to `zond-scenarios`

- Multi-step user journeys / business flows / fixture creation through the API.
- Failures whose root cause requires hand-written multi-step suites
  `zond generate` cannot express.

For YAML format (assertions, generators, captures, `always: true`,
`setup: true`), see `ZOND.md` or `zond run --help`.
