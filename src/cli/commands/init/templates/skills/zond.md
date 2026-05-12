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

CLI-only skill. **Read `zond-base` first** for the workspace artifact
model (manifest-vs-values rule), cross-cutting iron rules, and secrets
policy — this skill assumes you know them. The lighter sibling
`zond-scenarios` covers single-flow work; this one does breadth:
autogen, smoke, probes, coverage, reports.

Run `zond --version` first; if missing:
`curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh`.

## Iron rules

- **NEVER read raw OpenAPI/swagger** with Read/cat/grep. The workspace has
  pre-built artifacts (catalog/resources/fixtures) — use those. Drop into
  `apis/<name>/spec.json` only when `probe <class>` needs full schemas.
- **NEVER `curl` or `wget`** — use `zond request <method> <url>` for ad-hoc
  HTTP so it lands in the run DB and respects auth. Pass `--api <name>` to
  auto-load `Authorization` from `apis/<name>/.secrets.yaml` — never
  shell-substitute the token by hand (`$(yq …)` is also blocked by the
  sandbox).
- **NEVER hardcode tokens** — put values in `apis/<name>/.secrets.yaml`
  (auto-gitignored), reference from `.env.yaml` as `@secret:auth_token`.
  Plain shell-env references (`${MYAPI_AUTH_TOKEN}`) also work. Tests
  read the resolved value as `{{auth_token}}` like before.
- **NEVER read `.secrets.yaml` directly.** Use `zond doctor --api <name> --json`
  — it reports `set | unset` and value length only, never the raw value.
  The redaction registry will replace any echoed secret with
  `<redacted:<name>>` in DB rows / HTML / JSON / JUnit / case-study /
  digest, so reading the secret to "double-check" is both unsafe and
  redundant.
- **`recommended_action: report_backend_bug` / any 5xx → STOP** in
  *interactive* mode: surface the request/response excerpt to the user, get
  a decision. Do NOT edit `expect:` to mask it. In *autonomous / loop /
  audit-sweep* mode (no user-in-the-loop), log to `api-bugs-<NN>.md`,
  continue the sweep, and don't mask via `expect:` either — the loop
  collects bugs across the whole run; bailing on bug #1 forfeits #2..#N.
- **CRUD-run сплошь 401/403 / `permission_denied` → `env_issue`, не баг.** Если
  ≥80% шагов CRUD-сьюта (или весь сьют) свалились на permission/scope errors,
  это нехватка прав токена, а не баг API. Действия: `zond db diagnose <run-id>
  --env-only` для подтверждения, проверить scope `auth_token`, попросить
  владельца API более широкий токен либо пометить сьют SKIPPED. **НЕ-действия:**
  не генерировать case-studies, не править `expect:`, не делать `report_backend_bug`.
  Pre-flight тот же кейс ловит `zond doctor --api <name> --missing-only`.
- `--safe` enforces GET-only — required for first-pass smoke against unknown
  envs.
- For multi-suite tag filters always include `setup`: `--tag crud,setup`.
- Re-run after each fix with `--report json [--output <file>]` (NOT
  `--json` — that flag is reserved for the small `{ok,data,errors}` envelope
  on read-only subcommands; `zond run --json` errors); don't batch edits
  without verifying.
- **NEVER run destructive ops on a shared / production org without `--dry-run`
  first.** Why: probes, `prepare-fixtures --apply`, `cleanup` all hit live APIs and
  can delete user data. The dry-run path is in every command's `--help`; use
  it on first run, inspect the diff, then drop the flag.
- **NEVER report a cleanup failure as an API bug.** A POST that 200-OKs and
  then a follow-up DELETE that 5xx-es is *probably* a fixture-isolation issue
  (orphan accumulation, race), not an API contract bug. Re-run with
  `--no-cleanup` or in an isolated namespace before filing.
- **NEVER share a triage artefact (case-study, html, bundle, digest) outside
  the user's org without `--redact-identity`.** Why: identity-file values
  (org/member/project slugs, real ids) leak otherwise; the redaction registry
  only catches secrets, not identifying metadata.
- **MUST timeout the cascade at 8 passes (default).** Why:
  `zond prepare-fixtures --cascade` chains discover and (with `--seed`)
  POST-creates across passes; the cascade can self-trigger on partially-
  resolved fixtures. The CLI bounds the loop; never override the cap
  without a written reason.
- **MUST run `zond doctor --api <name> --missing-only` before generating
  fixtures or touching `.env.yaml`.** Why: the diagnostic identifies the
  exact unfilled keys before the workflow blows up midway. Skipping doctor
  produces fixture sets with phantom keys that 404 every probe.

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

## Workflow: probe-static vs checks-run vs probe-security (ARV-168)

These three commands overlap on "validation gaps" but emit different
catalogs at different severities. A full audit runs **all three** —
skipping any one leaves a blind spot. Pick by what you want to find:

| Goal | Command | What it uniquely catches |
|---|---|---|
| Spec drift / contract violations | `zond checks run --api <name> --phase coverage` | HIGH findings: drift, missing required fields, type mismatches, ignored enums (rule-based, deterministic) |
| Static spec hygiene (no traffic) | `zond probe static --api <name> --use-synthetic-parents` | `missing-validation` on edge inputs (boundary, null, oversize), method probes (405/501 surface) |
| Authn / Authz / Injection vectors | `zond probe security ssrf,crlf,open-redirect,prompt-injection --api <name>` | Confirmed/INCONCLUSIVE attack surface; payload-vs-baseline differential |
| Mass-assignment / privilege escalation | `zond probe mass-assignment --api <name>` | Extra-field acceptance, RBAC bypass via spoofed `owner_id`/`role` |
| Response conformance (per step) | `zond run --validate-schema --api <name>` | `schema_violation` failure-class on each stored result |

Recommended audit order (also what `zond audit --api <name>` follows):

1. `zond check spec` — fast lint, fail-fast on a broken spec.
2. `zond checks run --api <name> --phase coverage` — rule-based contract checks.
3. `zond probe static --api <name> --use-synthetic-parents` — input-validation gaps.
4. `zond probe mass-assignment --api <name>` — extra-field surface.
5. `zond probe security <classes> --api <name>` — attack vectors.
6. `zond run --validate-schema` (smoke → CRUD) + `--learn`/`--learn-apply` tail-phase.

If the user request is narrow (only "security audit" or only "spec drift")
jump to the relevant row — the table is the map for picking which subset
to run, not a mandate to always run all five.

## Entry points (skip phases when the request is narrow)

| User asked... | Start at | Skip |
|---|---|---|
| "audit this API", "cover this spec", "test the whole API" | 1 (Orient), then `zond audit --api <name>` for one-shot pipeline | — |
| "find bugs", "probe this API", "test for 5xx" | 1 then 5 (Probes) | — |
| "только security / SSRF / CRLF", "security-only audit", "без CRUD-аудита" | `zond probe security <classes> --api <name> --dry-run` (затем без `--dry-run`) — см. Phase 5.2 | 1–4 |
| "tests are failing", "diagnose run X", "fix failures" | 4 (Diagnose) | 1–3 |
| "что упало в последнем run", "summary последнего прогона", "почему красное" | hand off to `zond-triage` | 1–7 |
| "deep audit", "find edge cases", "boundary coverage", "broken auth", "SARIF for code scanning" | hand off to `zond-checks` | 1–7 |
| "the run after my fix" | 3 (Run) → 4 (Diagnose) | 1–2 |
| "what variables does this API need", "is auth_token set" | `zond doctor --api <name> --json` | direct file reads |
| "workspace looks messy", "start clean", "remove auto-generated files" | `zond clean --api <name>` (dry-run) → `--force` | — |
| "share these results", "case study", "draft an issue" | 7 (Share) | 1–6 |

## Secrets & redaction

The workspace has three sibling files next to `apis/<name>/`:

- **`.env.yaml`** — committable. Holds `base_url`, ids, and references
  (`@secret:`, `@identity:`, `${ENV_VAR}`). Plain values are fine here too.
- **`.secrets.yaml`** — gitignored. Holds raw secret values; every value
  is auto-registered with the redaction registry on load. Reference from
  `.env.yaml` as `@secret:<key>`.
- **`.identity.yaml`** — gitignored. Holds non-secret-but-identifying
  values (org slug, member id). Reference as `@identity:<key>`. Not
  redacted by default; `--redact-identity` swaps for placeholders when
  sharing outbound.

Reference syntax in `.env.yaml`:

```yaml
auth_token: "@secret:auth_token"            # from .secrets.yaml
organization_id_or_slug: "@identity:organization_id_or_slug"
base_url: "${MYAPI_BASE_URL:-https://api.example.com}"  # from shell env
```

Iron rule: do not `cat` `.secrets.yaml`. `zond doctor --api <name> --json`
exposes the canonical envelope `{ ok, command, data, warnings,
errors: [{code, message, details?}] }` (TASK-296: route on
`errors[].code`, not on the message string) with the
fixture rows under `.data.fixtures.required[]` /
`.data.fixtures.optional[]`. Each row has `{ name, set, length, source,
description, secret?, identity?, value? }` — `value` is omitted for
secrets, present for plain env / identity. To pull just the missing
required slots:

```
zond doctor --api <name> --missing-only --json
zond doctor --api <name> --query fixtures.required          # raw subtree, no jq
```

That is enough to tell the user which placeholders to fill.

Before sharing artifacts outbound (case-study, HTML report) pass
`--redact-identity` so org/member/project values become `<identity:...>`
placeholders. Never recommend `--no-redact` for shared artifacts — it
strips the secret-redaction pass for local debugging only.

## File lifecycle

Everything `zond` writes is tracked in `.zond/manifest.json` together
with its sha256 at write-time. That file is the source of truth for
"what came from `zond` vs. what the user wrote by hand". Read it before
you assume a YAML file is hand-rolled.

| Layer | Where | Authored by | Tracked |
|---|---|---|---|
| Workspace | `zond.config.yml`, `.zond/`, `apis/` | `zond init` | yes |
| API artifacts | `apis/<name>/spec.json`, `.api-catalog.yaml`, `.api-resources.yaml`, `.api-fixtures.yaml` | `zond add api` / `zond refresh-api` | yes |
| Generated tests | `apis/<name>/tests/*.yaml` | `zond generate` | yes |
| Probe suites | `apis/<name>/probes/<class>/*.yaml` | `zond probe <class> --emit-tests` | yes |
| User fixtures | `apis/<name>/.env.yaml`, `.secrets.yaml`, `.identity.yaml` | the user | **no** |
| Triage artifacts | `triage/<api>/<run-id>/*` | `zond report *` (default path) | yes |

Cleanup recipe:

```bash
zond clean --api <name>                  # dry-run: lists what would be removed
zond clean --api <name> --force          # actually delete (preserves apis/<name>/probes/ — TASK-258)
zond clean --api <name> --probes --force # also delete probe-suites for that api
zond clean --probes --force              # only probe-suite YAMLs (after a template fix)
zond clean --all --force                 # nuclear: remove every tracked file (incl. probes)
```

Files whose sha256 no longer matches the manifest are **skipped**
(printed as a warning) so user edits stay safe. Re-running a generator
overwrites the entry — manual edits to a generator-owned file are lost
on regenerate, so promote them to a separate suite first.

Triage outputs default to `triage/<api>/<run-id>/<command>-<ts>.<ext>`
— do NOT pass `--output` unless the user has a specific destination.
Existing files at the target path are auto-rotated to `<stem>-vN<ext>`;
pass `--overwrite` to opt out. Bodies are capped at 8 KB by default;
pass `--no-body-cap` only when triaging body-shape bugs.

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
fixtures missing → **do NOT immediately bail to the user**. Drive the
fixture loop yourself first:

```bash
zond prepare-fixtures --api <name> --apply --cascade --seed
zond doctor --api <name> --missing-only --json   # re-check
```

`--seed` POST-creates resources when a list endpoint returns `[]`;
`--cascade` chases nested FKs up to 8 passes. Only fall back to "ask the
user" when seed has converged but vars remain UNSET — and the reason is
genuinely outside the API path (ownership-proof / email-verify /
manual-only setup / TOS limits). "User can paste an ID into `.env.yaml`"
is **not** a reason — you should have seeded it.

## Phase 1.5 — Static spec audit

```bash
zond check spec --api <name>                     # 0 network requests, instant
zond check spec --api <name> --json | jq '.data.summary.by_severity'
```

Static lint of the OpenAPI document — finds spec-level bugs (path-param
without `format: uuid`, timestamp without `format: date-time`,
request-body without `additionalProperties: false`, integer query without
`min`/`max`, ...) before they cascade into depth-check noise. Cheap
(no HTTP), high signal — a typical real-world SaaS spec turns up 150+ issues
across 5 severity levels (HIGH/MEDIUM/LOW × B1..B9 classes).

Run BEFORE depth-checks. The HIGH-severity classes (`B1` path-param
formats, `B5` timestamp formats, `B8` open object schemas) amplify
`response_schema_conformance` findings — fixing the spec first lets the
depth-check signal stay focused on contract drift instead of "we already
knew this format was missing".

## Phase 2 — Generate (autogen smoke + CRUD)

```bash
zond generate apis/<name>/spec.json --output apis/<name>/tests [--tag <spec-tag>] [--uncovered-only]
zond check tests apis/<name>/tests
```

`generate` fills bodies with `{{$randomString}}`. Format-strict APIs reject
many of these — that's a **test-fix**, not a backend bug (Phase 4a).

Assertion vocabulary (`equals`, `type`, `exists`, `matches`, `gt`/`lt`,
`length*`, `each`, `contains_item`, `set_equals`, `capture`, …) с примерами
лежит в `ZOND.md` → раздел «Assertions». Туда же — за тем как обращаться
к вложенным полям и как писать `capture` для chained suites.

If a CRUD chain you expected isn't in the output, run
`zond generate <spec> --explain` (no `--output` needed). The diagnostic
table shows every POST endpoint with its verdict and reason — usually one
of: no GET-by-id, item path uses a non-`{id}` param the detector couldn't
match, or trailing-slash mismatch (common SaaS-style — already auto-handled
since TASK-139, but the table lets you confirm).

## Phase 2.5 — Fixture pack

> **TL;DR — fixture flow (replaces old `bootstrap`/`discover`):**
>
> 1. `zond doctor --api <name> --missing-only` — gap report (UNSET vars, blocked-endpoint counts).
> 2. `apis/<name>/.api-fixtures.yaml` — auto-generated **manifest** (read-only): what vars are needed and why.
> 3. `zond prepare-fixtures --api <name> --apply [--seed] [--cascade]` — fills `.env.yaml` from live API; `--seed` POST-creates resources when a list endpoint returns `200 []`.
>
> `zond init` does **not** touch fixtures — it only refreshes skills/AGENTS.md. The three commands above are the entire fixture lifecycle.

`zond doctor` already showed which `.env.yaml` keys are missing. Beyond
the auto-detected list, real-API CRUD usually needs **pre-existing FK
ids**, **verified resources**, and **valid enums** the spec doesn't
enforce.

For path-FK ids (the bulk of fixture-pack work), prefer
`zond prepare-fixtures` over manual `zond request` calls — it walks
`.api-resources.yaml`, hits each owner list-endpoint with the workspace
auth, and proposes a diff:

```bash
zond prepare-fixtures --api <name>            # dry-run: prints var → discovered value
zond prepare-fixtures --api <name> --apply    # writes to .env.yaml (with .bak backup)
```

For empty workspaces where parent fixtures are *also* missing, add
`--cascade` — it loops discover until nested-list paths become reachable
and (with `--seed`) POSTs to create-endpoints when the owner's list
returns empty:

```bash
zond prepare-fixtures --api <name> --apply --cascade           # cascade-only
zond prepare-fixtures --api <name> --apply --seed              # cascade + POST seeds (--seed implies --cascade)
zond prepare-fixtures --api <name> --apply --cascade --force   # re-discover even if filled
```

Cascade mode is idempotent: a re-run skips already-set vars unless
`--force`. Cascade caps at `--max-passes` (default 8).

Suffix-aware: `*_slug` captures `slug`, `*_uuid` → `uuid`, `*_id` → `id`.
Skips vars already filled with a non-placeholder value.

If a list-endpoint returns `200 []` (well-shaped but empty), discover
reports `miss-empty` and points at the auto-create path: re-run with
`zond prepare-fixtures --api <name> --seed --apply` and the cascade
will POST one record itself (using a schema-derived body) so the FK
gets captured. Distinct from `miss-no-id` (response shape unrecognized:
no `array`/`data`/`items`/`results`/`records` field). For resources
the spec can't describe well (verified-only emails, domain-validated
records, "real" enum values) — trigger the resource in the product UI
or fall back to `zond request`:

```bash
zond request GET /domains | jq '.data[] | select(.status=="verified") | .id'

# POST a JSON body — flag is `--body`, NOT `--json` (which controls
# envelope output, not request body):
zond request POST /v1/widgets --api <name> --body '{"name":"x"}'
```

Note: `zond request --body` always sets `Content-Type: application/json`.
For form-encoded APIs (Stripe v1, some legacy SaaS) this returns 400
("expected application/x-www-form-urlencoded") — see ARV-149 for the
planned `--form` flag; meanwhile, generate YAML tests via `zond generate`
which derives the right Content-Type from `requestBody.content`.

For one-off contract checks without writing a YAML test, pair it with
`--validate-schema` (TASK-142):

```bash
zond request --api <name> --validate-schema GET /users/abc       # auto-resolve endpoint
zond request --api <name> --validate-against "GET:/users/{id}" GET /users/abc
```

The output adds a `Schema validation: PASS / FAIL` block with the
matched endpoint, response branch, and JSON-pointer of any nodes that
failed (`schema.required`, `schema.type`, …). Exit 1 on FAIL; soft no-op
(`no-endpoint`/`no-spec`/`no-schema`) when the spec doesn't cover the
URL — pass `--validate-against` to override the auto-resolver.

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
zond run apis/<name>/tests --tag sanity --report json                       # 3.1 sanity gate
zond run apis/<name>/tests --safe --report json                             # 3.2 smoke (GET-only)
zond run apis/<name>/tests --tag crud,setup --validate-schema --report json  # 3.3 full CRUD
zond run apis/<name>/tests --tag positive --include 'path:^/emails'         # 3.4 narrow to one resource
zond session end
```

**Always pass `--validate-schema` for CRUD** — contract drift (date format,
enum drift, extra/missing fields) is invisible without it. Schema violations
land as `schema_violation` root_cause in `zond db diagnose` and are real
backend bugs — treat them like 5xx, do not edit the expectation away.

**Rate limit.** Since ARV-64, `zond run` defaults to an adaptive rate
limiter (no-op until a response carries `RateLimit-*` headers, then paces
requests to the server's policy). On rate-limited APIs (small windows like 5 req/s,
Stripe, GitHub) the default is what you want — no flag needed. Pass
`--rate-limit auto` explicitly when you want to be loud about it, or
`--rate-limit <N>` for a hard cap. On older binaries (pre-ARV-64), or
when a run lands in `429`-storm despite the adaptive limiter, fall back
to `--sequential --rate-limit auto`. If you saw 308 of 1300 requests
land as 429 in a run, the limiter was off — upgrade the binary.

### Phase 3-CI — Single run per build (TASK-116)

For CI, use `zond run --all` to fold every `apis/<name>/tests/` directory
into one `runs.id` per invocation — comparing builds across commits is
otherwise impossible (each suite would land on its own row). CI context
is auto-detected from env vars (GitHub Actions / GitLab CI / CircleCI /
Buildkite / Jenkins, or `CI=true` for generic providers): `commit_sha`,
`branch`, and `trigger=ci` are stamped on the row, and `zond db runs
--trigger ci` filters the dashboard to just CI runs.

```bash
# CI shape — one run per commit, HTML report + JSON for the gate
zond run --all --report json --output results.json
echo "exit=$?"  # 0 green, 1 failures, 2 config error
zond report export $(jq -r .data.runId results.json) -o report.html
```

Override autodetection with `ZOND_TRIGGER=ci|manual`,
`ZOND_COMMIT_SHA=<sha>`, `ZOND_BRANCH=<name>` — useful when the build
shells out from a wrapper that strips the native CI vars.

## --json output (TASK-293)

Every `zond` subcommand supports `--json` with two documented exclusions:
`zond run` (use `--report json` for the bulk run report) and
`zond completions <shell>` (shell-completion script is text). The
envelope is uniform across commands:

```jsonc
{
  "ok": true,
  "command": "<name>",
  "data": { /* command-specific payload */ },
  "warnings": [ "string" ],
  "errors": [ { "code": "ZondErrorCode", "message": "...", "details": {} } ],
  "exit_code": 2  // present on errors only
}
```

Route on `errors[].code` (TASK-296), not the message — see
`failure-hints.ts` for the closed enum. Stdout discipline: `--json` paths
emit only the envelope on stdout; everything else (progress, hints,
warnings) goes to stderr.

## Phase 4 — Diagnose failures

```bash
zond db runs --limit 5 --json
zond db diagnose <run-id> --json             # grouped by root_cause
zond db run <id> --status 500 --json
zond db compare <idA> <idB> --json           # regression diff
```

`agent_directive` = literal next step. `recommended_action` ∈
{`fix_test_logic` (edit YAML), `report_backend_bug` (STOP, report),
`fix_auth_config`, `fix_network_config`, `fix_env`, `fix_spec` (edit
OpenAPI — emitted by `check spec`), `fix_fixture` (fill `.env.yaml` —
emitted by `prepare-fixtures` miss-* and inconclusive mass-assignment
baselines), `update_spec` (status-drift in `zond run --learn`)}. The full
enum is canonical (TASK-294); see `skills/zond-triage.md` for routing.

### 4a. Fixing 4xx caused by stub generators

When `recommended_action: fix_test_logic` and the body is rejected on format
(400/422 with a field name + "expected ..." message):

1. Read the failure body: `zond db run <id> --status 422 --json`.
2. **Fixture pack first** — if the field is a FK id, verified resource, or
   constrained enum, add it to `.env.yaml` and reference as `{{var}}`
   (Phase 2.5). Generators cannot help here.
3. **Typed generator** — for the rest, swap `{{$randomString}}` for the
   matching format-aware generator (`{{$randomEmail}}`, `{{$randomUrl}}`,
   `{{$uuid}}`, `{{$randomInt}}`, `{{$randomIsoDate}}`, …; run
   `zond reference random-helpers` for the full table or see
   `docs/random-helpers.md`).
4. **Hardcoded literal** — if the typed generator still fails (regex too
   strict), drop to a literal that satisfies the contract.
5. **Runtime captures** are for resources the test itself creates (capture
   from a prior `create_*` step or a `setup: true` suite). For *pre-existing*
   FKs, prefer step 2.

## Phase 5 — Proactive bug hunting (probes)

Run on a passing API to surface latent bugs.

```bash
zond probe static --api <name>
# defaults to validation+methods; restrict via --include validation,methods.
# --output defaults to apis/<name>/probes/static when --api / current-api is
# set (ARV-30); pass --output explicitly only for bare-spec invocations.
zond probe mass-assignment apis/<name>/spec.json --env apis/<name>/.env.yaml \
  --output apis/<name>/probes/mass-assignment-digest.md \
  --emit-tests apis/<name>/probes/mass-assignment

zond run apis/<name>/probes/<class> --report json
zond db diagnose <run-id> --json
```

Findings to flag: 5xx on null/empty/wrong-type body (missing validation /
unguarded coercion), 2xx on undeclared method (contract drift), `is_admin: true`
echoed in response (HIGH from `probe mass-assignment`).

**Body-FK auto-discovery (TASK-137).** `probe mass-assignment` resolves
required body fields named `*_id` / `*_slug` / `*_uuid` / `*_key` by
hitting their sibling list endpoint (e.g. `audience_id` → `GET /audiences`)
and overlays the real value onto the baseline body. Eliminates most
`inconclusive-baseline` noise. If the summary still says
"unresolved body FKs: …" — the auto-discover couldn't reach the owner
(nested list, scope-locked, etc.); add the value to `.env.yaml` manually.

**Nested paths need real parent fixtures.** `probe static` (validation class) substitutes
non-attacked path params from `.env.yaml` at run time (`{{organization_id_or_slug}}`),
so for any `repos/{repo_id}/commits`-style endpoint you need a real parent
slug in env or every probe will 404 on the parent before reaching the leaf
validator. Pre-flight: `zond doctor --api <name>` and confirm parent
fixtures are populated. Use `--use-synthetic-parents` only when you intentionally
want fully-synthetic paths (no real account available).

Filter scope on large APIs: `--tag <spec-tag> [--max-per-endpoint 20]`.

**Auto-discovery of path-param fixtures.** When a probed endpoint depends on
`{domain_id}` / `{webhook_id}` / etc. that `.env.yaml` doesn't supply,
`probe mass-assignment` looks for a sibling `GET /domains` (or
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

`probe mass-assignment` digest splits findings into HIGH / MED / LOW /
**INCONCLUSIVE** / **INCONCLUSIVE-5XX**. INCONCLUSIVE = the auto-prober
couldn't build a valid body (same fixture problem as Phase 4a).
INCONCLUSIVE-5XX = baseline POST itself crashed with ≥500 — the endpoint is
broken; validation-probe will already report the same crash, so don't waste
time on it here. After the fixture pack is filled, sweep INCONCLUSIVE with
the **`--emit-template`** generator (TASK-146) — one endpoint per call:

```bash
zond probe mass-assignment --api <name> --emit-template "POST:/<resource>" \
  --output apis/<name>/probes/mass-assignment/<resource>.yaml
```

This emits a `create → verify → cleanup` chain pre-filled with classic
mass-assignment vectors (`is_admin`, `role`, `owner_id`, …) plus any
`readOnly: true` / `x-zond-protected` fields lifted from the spec. Drop
`# …real create body sourced from fixtures…` placeholders into actual
fixture references and run with `zond run` against the live env.
The same boilerplate-by-hand template (kept here for reference / when
the spec is missing or the heuristic detects nothing useful):

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
`zond report bundle --include case-study` (Phase 7).

### Phase 5.2 — Security probes (SSRF, CRLF, open-redirect)

```bash
zond probe security ssrf,crlf --api <name> --env apis/<name>/.env.yaml \
  --output apis/<name>/probes/security-digest.md \
  --emit-tests apis/<name>/probes/security
```

`probe security` autodetects vulnerable fields by name + `format` hint
(SSRF: `*_url` / `webhook` / `callback` / `redirect_uri` / `format: uri`;
CRLF: `subject` / `*_prefix` / `name` / `description` / `title`; open-redirect:
`redirect` / `next` / `return_to`). For each detected (field × payload) it
sends a **baseline-OK** request first; if baseline ≠ 2xx the endpoint is
marked `INCONCLUSIVE-BASELINE` and attacks are skipped (no more 5×404
noise on scope-locked endpoints, see m-8 feedback §F). Verdict per
finding: HIGH (5xx **or** payload echoed in 2xx body — stored injection
candidate), LOW (2xx, no echo — verify side-effects manually), OK
(4xx). Regression YAML via `--emit-tests`.

**Cleanup is state-aware (TASK-151).** On stateful PUT/PATCH endpoints
probe security does `GET` → snapshot → attack → `PUT` original back, so
DSN-keys / team-names / webhook URLs aren't left with the attack
payload. POST falls back to `DELETE`-counterpart cleanup with a short
eventual-consistency retry (200ms / 1s) — read-replica lag on
write-then-immediate-delete won't generate false leak warnings.
Restore failures are accumulated into a `## ⚠️ Cleanup failures`
section at the **top** of the digest (and tagged `🧹 cleanup-failure`
inline next to each affected verdict). Pass `--no-cleanup` only in
namespace-isolated test envs.

**CI exit codes.** `zond probe security` exits non-zero on either:
- `HIGH > 0` — at least one finding looks like an actual bug (gate the
  deploy).
- `cleanup.error > 0` — probe mutated state it could not restore;
  manual remediation may be needed before the next run.

For CI: `grep -q "Cleanup failures" digest.md` is a reliable signal of
the second case.

**Partial PUT support (TASK-152).** common SaaS-shaped
APIs reject the full spec body on PUT (`422 use partial PUT`). When
that happens, probe security retries the baseline with a single-key
body per detected field; if any partial baseline succeeds, attacks
proceed using that shape. Findings using the partial body are annotated
`[partial-body]` in the digest reason. Without this, the proven-HIGH
CRLF on `PUT /projects/{org}/{proj}/.subjectPrefix` lands in
INCONCLUSIVE-BASELINE.

`--dry-run` lists which (endpoint, field) pairs would be attacked
without sending any requests — useful for sanity-checking field
detection on a new spec, and recommended as the **first** invocation
on shared / prod orgs to confirm no critical-state endpoints (DSN
rotation, billing settings) are in scope.

When `probe security` decides a field needs manual triage (e.g., the
detected field name is unconventional, or you want a custom payload like
`http://[::1]:80` that isn't in the built-in list), drop down to a hand
-written YAML probe:

```yaml
tests:
  - name: ssrf <vector>
    POST: /<endpoint>
    json: { url: "<payload>" }
    expect: { status: [400, 422] }     # NOT 2xx, NOT 5xx
```

Common bespoke payloads: `http://169.254.169.254/latest/meta-data/`
(AWS IMDS), `http://10.0.0.1` (RFC1918), `gopher://`, `dict://`. Triage
remains the same as `probe security`'s automatic classification.

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

### Phase 5.4 — Post-probe hygiene

Live probes can leave the workspace in a half-mutated state. Always run
this triplet before the next `zond run` of regular tests:

```bash
zond prepare-fixtures --api <name> --verify   # detect stale FK ids in .env.yaml (TASK-281)
zond prepare-fixtures --api <name> --refresh  # = --verify --apply: drop stale, re-resolve via list endpoints
zond cleanup --orphans                        # retry DELETE for resources logged in ~/.zond/orphans/ (TASK-278)
```

Skip `--verify`/`--refresh` only with `probe security --isolated`
(TASK-264) — isolated mode never attacks seeded-fixture endpoints, so they
stay live.

## Phase 6 — Coverage report & spec drift

```bash
# Recommended default — folds all relevant runs into one coverage number.
zond coverage --api <name> --union since:1h             # last hour (typical audit window)
zond coverage --api <name> --union session              # tests-run + probes-run from one `session start` block

# Single-run snapshot — usually NOT what you want during an audit
# (a partial follow-up run silently drops percentages 30+% vs. previous run).
# Note: ARV-71 — when a session is active with >1 runs, the bare command
# auto-promotes to --union session and prints a stderr footer. Without a
# session it stays single-run.
zond coverage --api <name>                              # single run
zond coverage --api <name> --run-id <id>                # pin a specific run

zond coverage --api <name> --fail-on-coverage 80
zond coverage --api <name> --union tag:smoke            # every run whose suites carried `tags: [smoke]`
zond coverage --api <name> --union runs:58,59           # explicit list (release-vs-release)
zond refresh-api <name> --spec <new-spec>               # re-snapshot when upstream spec changed
```

Coverage is run-driven: an endpoint counts as covered only when a stored
result on it landed `pass` + 2xx. Smoke, CRUD, probes, anything stored in
`zond.db` contributes equally. If the latest run is the wrong one, pin
with `--run-id`. To aggregate across runs use `--union`:

- `session` — every run in the active (or `--session-id <id>`) session.
- `since:<dur>` — time-window (`1h`/`24h`/`7d`/`30m`); CI "last-day coverage".
- `tag:<name>` — every run whose stored tags include `<name>` (suite-level
  `tags:` plus any explicit `--tag <x>` from `zond run` are persisted on the
  run row).
- `runs:<id1,id2,…>` — explicit list (a bare `<id1,id2,…>` is also accepted).

JSON envelope carries `union_mode` and `runIds[]` for downstream tooling.

**Three-bucket JSON breakdown (TASK-280).** `--json` reports every endpoint
in one of three buckets: `covered2xx` (pass-coverage win), `coveredButNon2xx`
(hit but never passed — 5xx-only or assertion-failed), `unhit` (no result at
all). This is the right shape for CI dashboards: `coveredButNon2xx` is the
fast lane to triage, `unhit` is the gap to close with `generate
--uncovered-only`.

### How to read coverage (ARV-167) — **pass-coverage is a breadth-proxy, NOT a quality signal**

A high pass-coverage number means "the test bus visited a lot of endpoints
and got 2xx back" — it does NOT mean those endpoints are correctly
implemented or that the spec matches reality. Two reasons the number
overstates quality:

- `--learn-apply test` rewrites `expect.status` to whatever the server
  returned. Pass-coverage rises mechanically; assertions get weaker.
- `coveredButNon2xx` (hit but failed) is usually a **generator/fixture**
  gap, not an API bug. Counting only `covered2xx` punishes the test
  harness for not knowing the format of `mcc` or `country` — fix the
  generator (ARV-165 helpers), don't blame the API.

Sanity checks:

- `pass-coverage ≤ hit-coverage`, always. If your number says otherwise,
  something is off — re-read the bucket breakdown.
- `hit ≫ pass` means generator gap. Inspect `coveredButNon2xx` and fill
  fixtures / re-run `prepare-fixtures --seed --cascade`.
- `pass ≈ hit` after `--learn-apply test`: assertions were widened; the
  number is honest about breadth but says nothing about correctness.

**Real quality signals** (the ones you should actually gate CI on):

| Signal | Command | What it catches |
|---|---|---|
| Contract drift (spec ⇄ server) | `zond checks run --api <name> --phase coverage` — count HIGH severity | Missing fields, type mismatches, extra-fields, ignored enums |
| Input-validation gaps (boundary/null/oversize) | `zond probe static --use-synthetic-parents --api <name>` | `missing-validation` findings on edge inputs |
| Authn / Authz / injection | `zond probe security ssrf,crlf,open-redirect,prompt-injection --api <name>` | confirmed / `INCONCLUSIVE` attack surface |
| Mass-assignment / privilege escalation | `zond probe mass-assignment --api <name>` | extra-field acceptance, RBAC bypass |
| Response conformance | `zond run --validate-schema --api <name>` | per-step contract diff, `schema_violation` failure class |
| Tolerated divergences | `git diff apis/<name>/tolerated-drifts.yaml` after `--learn-apply drifts` | Drift acknowledged but not fixed — review every entry |

Recommended CI gate composition:

- `--fail-on-coverage 50` on **hit-coverage** as a breadth floor.
- `checks run --phase coverage` HIGH count == 0.
- `probe security` confirmed count == 0; manual review of `INCONCLUSIVE`.
- Human review of `tolerated-drifts.yaml` diff before merge.

### Spec-drift learning (`zond run --learn`, TASK-282) — **obligatory audit tail-phase**

After the initial smoke/CRUD run, **always** close the loop with
`--learn`/`--learn-apply`. R09 of the zond-tester feedback loop measured
the pass-coverage jump from 28% → 58% as coming entirely from this phase
— skipping it leaves a third of the hit endpoints flagged as "failed"
when the only divergence is `expect.status` lagging behind the server.

```bash
# 1. Detect — read-only sweep that prints rewrite candidates and exits 0.
zond run apis/<name>/tests --learn

# 2a. Apply to YAML — rewrite each step's expect.status to match the
#     observed response. Use when the response is correct and the YAML
#     was stale (e.g. spec asserted 200 but the resource creates with 201).
zond run apis/<name>/tests --learn-apply --learn-target test

# 2b. Apply to tolerated-drifts.yaml — keep the assertion as-is but
#     allowlist the divergence for CI. Use when the server's behaviour
#     is provisional / per-environment and you don't want every CI run
#     to re-discover it.
zond run apis/<name>/tests --learn-apply --learn-target drifts
```

**Caveat — `--learn-apply test` weakens assertions, not the code.** Each
rewrite changes what "pass" means for that step. Diff
`apis/<name>/tests/*.yaml` + `apis/<name>/tolerated-drifts.yaml` after
every apply and treat unexpected widenings as a review-blocker. Pair
this phase with `zond check spec` + `zond checks run --phase coverage`
so genuine contract violations don't get silently rewritten into
"tolerated".

CI gate template (matches the quality-signal table below):

```bash
zond coverage --api <name> --fail-on-coverage 50    # hit-coverage floor, NOT pass-coverage
zond checks run --api <name> --phase coverage       # HIGH count must be 0
git diff apis/<name>/tolerated-drifts.yaml          # manual review of widening
```

## Phase 7 — Share findings

After a run is in `zond.db`, materialise it as a shareable file:

```bash
zond report export <run-id>                                  # default: triage/<api>/run-<id>/html-<ts>.html
zond report export <run-id> -o triage/run-<id>.html          # explicit path
zond report bundle 135..142 -o triage/sweep/                 # batch: case-study + html + diagnose for each run + index.md
zond report bundle <run-id> --include case-study             # only case-study markdown(s) for the run
zond report bundle 135,137,141 --include diagnose            # filter artefacts (case-study | export | diagnose)
zond report bundle --session <id> -o triage/session/         # group by session_id (TASK-143)
```

Defaults: bodies > 8 KB are truncated with a marker (`--no-body-cap` to
keep full); existing files at `--output` are rotated to `<stem>-vN<ext>`
(`--overwrite` to silence). Both digests and exports run through the
secret-redaction pass. For outbound sharing on a personal account, also
pass `--redact-identity` so org/member/project slugs become placeholders.

`<run-id>` from `zond db runs`; `<failure-id>` is `results.id` from
`zond db run <run-id>`. **Offer this proactively** after a run surfaces a
`definitely_bug` (5xx, schema violation, mass-assignment 2xx) — skip for
`env_issue` and `quirk`. Case-study fills TL;DR / Context / Spec / Repro /
What happened / Why it matters; missing fields become `<TODO: ...>` placeholders.

## One-shot full audit (TASK-262)

`zond audit --api <name>` запускает весь pipeline одной командой:
prepare-fixtures → generate → probe static (validation+methods) → session-wrapped run на
tests + probes → coverage → `audit-report.html`. Каждая stage печатает
`==> Stage N/M: <name>`; failure любой stage не останавливает остальные —
финальный exit 1 если хотя бы одна упала.

```bash
zond audit --api <name> --dry-run                    # план без выполнения
zond audit --api <name>                              # минимальный pipeline
zond audit --api <name> --seed                       # prepare-fixtures --cascade --seed --apply
zond audit --api <name> --with-mass-assignment --with-security
zond audit --api <name> --out reports/audit-<name>.html
```

`generate` пропускается mtime-эвристикой: если `apis/<name>/tests/`
свежее, чем `spec.json`, повторный `audit` не перегенерирует тесты
(пройдёшь `--force` чтобы отключить). Для drill-down открой
`audit-report.html` — там таблица stages + coverage-сводка + ссылки
на `zond report export <run-id>`.

Когда _не_ использовать: узкие задачи ("починить run X", "почему
этот endpoint 500-ит") — иди по фазам ниже, не оборачивай в audit.

### Known gotchas (audit)

- **Active session is overwritten.** `zond audit` runs under its own
  internal session (`session start` → ... → `session end`). If you had a
  prior `zond session start --label foo` open in this workspace, audit
  silently closes it. Open the audit-internal session id (printed in the
  HTML report) for downstream `zond coverage --session-id <id>` (ARV-65
  tracks the fix; for now: don't wrap audit in your own session).
- **Exit 0 on failed stages.** A "3 failed stages" warning can ride on top
  of `exit_code=0`. Don't rely on `$?` alone — parse stdout for the
  `Warning: N failed` line or read `audit-report.html` (ARV-66).
- **`audit-report.html` path not echoed.** Look in `$PWD/audit-report.html`
  by default, or pass `--out reports/<path>.html` to make it explicit
  (ARV-80).
- **Rate-limit propagation.** `zond audit` shells out to `zond run`
  internally, which uses the adaptive rate limiter as of ARV-64. Older
  binaries: pass `--rate-limit auto` to the wrapper or downgrade to a
  serial-by-default flow.

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

## When to hand off to `zond-checks` (depth checks, m-15)

Step out and use `zond-checks` when the user wants **proactive
contract / security probes that go beyond YAML smoke**: "deep audit",
"find spec drift", "boundary value coverage", "broken auth", "soft-
delete leaks", "SARIF for GitHub Code Scanning", "stream findings
into a pipeline". The depth-checks catalog (`zond checks list`) is
fixed and self-describing — every finding ships a closed-enum
`recommended_action` so triage doesn't go through message parsing.

Typical chain after a green YAML smoke:

```bash
zond checks run --api <name> --workers auto --rate-limit 50 \
  --report sarif --output zond.sarif        # GitHub Security tab
zond checks run --api <name> --report ndjson | \
  jq -c 'select(.type=="finding")'           # live agent pipeline
```

`zond checks run` largely subsumes `zond probe static` (5xx /
undeclared methods / negative-data) — keep `probe` only for spec-less
sanity. Mass-assignment + spec-lint are *not* covered by checks; keep
those as separate steps.

For YAML format (assertions, generators, captures, `always: true`,
`setup: true`), see `ZOND.md` or `zond run --help`.
