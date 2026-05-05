---
name: zond
description: |
  Full API audit with zond — autogenerate tests from an OpenAPI spec, run a
  multi-phase sweep (sanity → smoke → CRUD → probes → coverage), and produce
  shareable bug reports. Use when the user asks for: a full audit, broad
  coverage, contract-drift check, probe sweep, schema-drift detection, post-
  deploy regression, "find bugs in this API", "test for 5xx", "generate tests
  for the whole API", "raise coverage", "diagnose run", "case study". For a
  single user flow / scenario, hand off to `zond-scenarios`.
allowed-tools: [Read, Write, Edit, Bash(zond *), Bash(bunx zond *), Bash(sqlite3 *)]
---

# zond — Full API audit

CLI-only skill. The lighter sibling `zond-scenarios` covers single-flow
work; this one does breadth: autogen, smoke, probes, coverage, reports.

Run `zond --version` first; if missing:
`curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh`.

## Iron rules

- **NEVER read raw OpenAPI/swagger** with Read/cat/grep. The workspace has
  pre-built artifacts (catalog/resources/fixtures) — use those. Drop into
  `apis/<name>/spec.json` only when probe-* needs full schemas.
- **NEVER `curl` or `wget`** — use `zond request <method> <url>` for ad-hoc
  HTTP so it lands in the run DB and respects auth.
- **NEVER hardcode tokens** — put in `apis/<name>/.env.yaml` (auto-gitignored),
  reference as `{{auth_token}}`.
- **`recommended_action: report_backend_bug` / any 5xx → STOP.** Surface the
  request/response excerpt to the user; do NOT edit `expect:` to mask it.
- `--safe` enforces GET-only — required for first-pass smoke against unknown
  envs.
- For multi-suite tag filters always include `setup`: `--tag crud,setup`.
- Re-run after each fix with `--json`; don't batch edits without verifying.

## Workspace assumption

By the time this skill is active, the user has run `zond init` and
`zond add api <name> --spec <path|url>`. That means `apis/<name>/`
already contains `spec.json` (machine source) plus three artifacts:

| File | Purpose |
|---|---|
| `.api-catalog.yaml` | Endpoint shape — read this for navigation. |
| `.api-resources.yaml` | CRUD chains, FK deps, ETag/soft-delete flags — read for setup planning. |
| `.api-fixtures.yaml` | Required `{{vars}}` with descriptions — read for fixture pack. |

If any artifact is missing or stale (`zond doctor` flags it), run
`zond refresh-api <name>` before continuing.

## Entry points (skip phases when the request is narrow)

| User asked... | Start at | Skip |
|---|---|---|
| "audit this API", "cover this spec", "test the whole API" | 1 (Orient) | — |
| "find bugs", "probe this API", "test for 5xx" | 1 then 5 (Probes) | — |
| "tests are failing", "diagnose run X", "fix failures" | 4 (Diagnose) | 1–3 |
| "the run after my fix" | 3 (Run) → 4 (Diagnose) | 1–2 |
| "share these results", "case study", "draft an issue" | 7 (Share) | 1–6 |

## Phase 1 — Orient

```bash
zond doctor --api <name> --json                  # fixture gaps + artifact freshness
```

Then read three artifacts (NOT raw spec):

```bash
cat apis/<name>/.api-catalog.yaml | head -80
cat apis/<name>/.api-resources.yaml
cat apis/<name>/.api-fixtures.yaml
```

If `doctor` reports stale → `zond refresh-api <name>`. If required
fixtures missing → ask the user to fill `.env.yaml` and pause until they
confirm.

## Phase 2 — Generate (autogen smoke + CRUD)

```bash
zond generate apis/<name>/spec.json --output apis/<name>/tests [--tag <spec-tag>] [--uncovered-only]
zond validate apis/<name>/tests
```

`generate` fills bodies with `{{$randomString}}`. Format-strict APIs reject
many of these — that's a **test-fix**, not a backend bug (Phase 4a).

## Phase 2.5 — Fixture pack

`zond doctor` already showed which `.env.yaml` keys are missing. Beyond
the auto-detected list, real-API CRUD usually needs **pre-existing FK
ids**, **verified resources**, and **valid enums** the spec doesn't
enforce. Use `zond request` to discover them:

```bash
zond request GET /audiences | jq '.data[0].id'
zond request GET /domains   | jq '.data[] | select(.status=="verified") | .id'
```

Add to `apis/<name>/.env.yaml`:

```yaml
base_url: https://api.example.com
auth_token: <secret>
audience_id: "0b141f35-..."
verified_from_email: "onboarding@example.dev"
real_to_email: "delivered@example.dev"
region: "us-east-1"
```

Reference as `{{audience_id}}`, `{{verified_from_email}}`, etc. Skip on
mock servers, `--safe` runs, and specs with no `format:` constraints.
Re-run `zond doctor` to confirm zero required gaps before Phase 3.

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
zond run apis/<name>/tests --tag crud,setup --validate-schema --json  # 3.3 full CRUD
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
zond probe-validation apis/<name>/spec.json --output apis/<name>/probes/validation
zond probe-methods    apis/<name>/spec.json --output apis/<name>/probes/methods
zond probe-mass-assignment apis/<name>/spec.json --env apis/<name>/.env.yaml \
  --output apis/<name>/probes/mass-assignment-digest.md \
  --emit-tests apis/<name>/probes/mass-assignment

zond run apis/<name>/probes/<class> --json
zond db diagnose <run-id> --json
```

Findings to flag: 5xx on null/empty/wrong-type body (missing validation /
unguarded coercion), 2xx on undeclared method (contract drift), `is_admin: true`
echoed in response (HIGH from `probe-mass-assignment`).

Filter scope on large APIs: `--tag <spec-tag> [--max-per-endpoint 20]`.

**Auto-discovery of path-param fixtures.** When a probed endpoint depends on
`{domain_id}` / `{webhook_id}` / etc. that `.env.yaml` doesn't supply,
`probe-mass-assignment` looks for a sibling `GET /domains` (or
`/orgs/{org_id}/projects` for nested), calls it once per run, pulls
`data[0].id` (also tries `items[0].id` and top-level array shapes), and
reuses that value for every endpoint sharing the same parent. Cached, so
each list is hit at most once per run. Failures still SKIP the endpoint but
the digest now spells out *why* (`auto-discover failed (GET /domains
returned empty list)` etc.). Pass `--no-discover` to opt out when GET
side-effects are unwanted. Don't ask the user to fill a path-param into
`.env.yaml` before checking the digest — auto-discovery may already cover
it.

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
zond coverage --api <name> --run-id <id>           # per-run
zond refresh-api <name> --spec <new-spec>          # re-snapshot when upstream spec changed
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

Step out of `zond` and let `zond-scenarios` take over when the user asks
to **verify a specific flow** rather than audit the API: "test the
checkout", "what happens after refund", "repro this bug from prod". The
scenarios skill writes hand-crafted multi-step YAML; this audit skill
focuses on autogenerated breadth + probes.

For YAML format (assertions, generators, captures, `always: true`,
`setup: true`), see `ZOND.md` or `zond run --help`.
