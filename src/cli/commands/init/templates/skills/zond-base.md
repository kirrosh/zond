---
name: zond-base
description: |
  Foundation for any zond work. Read this **first** whenever you touch a
  workspace registered via `zond add api`. Defines the artifact model
  (`spec.json`, `.api-catalog.yaml`, `.api-resources.yaml`,
  `.api-fixtures.yaml`, `.env.yaml`), the manifest-vs-values contract for
  fixtures (which is the #1 source of confusion in this project), the
  cross-cutting iron rules (secrets, redaction, destructive ops), and the
  router to pick between siblings: zond (audit), zond-scenarios,
  zond-checks, zond-triage. Auto-loads when the user mentions any
  `apis/<name>/`, `.env.yaml`, `.api-fixtures.yaml`, or asks "where do I
  start" / "what is X file".
allowed-tools: [Read, Bash(zond *), Bash(bunx zond *)]
---

# zond-base — Workspace contract & sub-skill router

This skill is the foundation. It does **not** drive any specific
workflow — for that, hand off:

| User intent | Skill |
|---|---|
| Full audit (autogen → smoke → CRUD → probes → coverage → report) | `zond` |
| Author/run a single user-flow scenario | `zond-scenarios` |
| Depth checks (conformance + security, schemathesis-style) | `zond-checks` |
| "What broke in the last run?" | `zond-triage` |

When in doubt, default to `zond-scenarios` for narrow asks, `zond` for
broad asks.

## Workspace artifact model

After `zond add api <name> --spec <path|url>`, the workspace gets:

```
apis/<name>/
  spec.json              ← dereferenced OpenAPI (machine source)
  .api-catalog.yaml      ← human/agent-readable endpoint index
  .api-resources.yaml    ← CRUD chains + FK dependencies
  .api-fixtures.yaml     ← MANIFEST: required vars (read-only)
  .env.yaml              ← VALUES: variable values (user-edits)
  .secrets.yaml          ← committable references (`@secret:NAME`); auto-gitignored
  .identity.yaml         ← non-secret identity values (org slugs, member ids)
  tests/                 ← generated/handwritten suites
  scenarios/             ← handwritten scenario suites
  probes/                ← probe-emitted suites
```

### The most important rule (manifest vs values)

**`.api-fixtures.yaml` is the single source of truth for the *list* of
variables this API needs. `.env.yaml` only stores their *values*.**

| Operation | Touches manifest? | Touches env? |
|---|---|---|
| `zond add api` / `refresh-api` | rebuilds | seeds skeleton |
| `zond generate` | extends (adds new `{{var}}` it discovered in request bodies) | does **not** modify |
| `zond prepare-fixtures` (discover) | reads (iterates entries) | writes values for filled vars |
| `zond prepare-fixtures --seed --apply` | reads | writes values from POST responses |
| user editing | never | always |

**Consequences:**

- A `{{var}}` in a generated test that is **not** in `.api-fixtures.yaml`
  is a bug — either in the manifest builder or in the generator. Don't
  "fix" it by adding the key to `.env.yaml`.
- A key in `.env.yaml` that is **not** in `.api-fixtures.yaml` is
  legacy / shadow — `zond prepare-fixtures` warns `not in manifest,
  ignored` and skips it. Don't rely on it to seed discovery.
- "Generate should sync `.env.yaml`" is a **rejected design**. It would
  create two parallel sources of truth for the variable list. See
  `backlog/decisions/decision-7` and `backlog/milestones/m-17 -
  agent-api-contracts.md` for the full rationale.

### When to read which file

| You want to know… | Read this |
|---|---|
| What endpoints exist (path/method/summary) | `.api-catalog.yaml` |
| How resources chain (CRUD, FK, ETag) | `.api-resources.yaml` |
| What variables are needed and **why** | `.api-fixtures.yaml` |
| What variable values are set | `.env.yaml` |
| Full schema of a request/response (only when needed) | `spec.json` |

**Never** read external `--spec` paths via `Read`/`cat` — all consumers
go through `resolveCollectionSpec()` which resolves `apis/<name>/spec.json`.
**Never** read `.secrets.yaml` directly — use
`zond doctor --api <name> --json` (returns `set | unset` and length only).

## Fixture & env workflow (canonical loop)

The fixture loop replaces the old `bootstrap` + `discover` pair. Three
commands cover the whole lifecycle:

| Step | Command | Reads | Writes |
|---|---|---|---|
| 1. Gap report | `zond doctor --api <name> --missing-only` | `.api-fixtures.yaml`, `.env.yaml` | nothing |
| 2. Inspect manifest (optional) | `cat apis/<name>/.api-fixtures.yaml` | manifest | nothing |
| 3. Fill values | `zond prepare-fixtures --api <name> --apply [--seed] [--cascade]` | `.api-fixtures.yaml`, live API | `.env.yaml` (with `.bak`) |

`--seed` (new vs old `discover`): when a list endpoint returns `200 []`,
POST-create one record from a schema-derived body and capture its id. Skip
this on production/shared orgs without `--dry-run` first.

### Write-only / SDK-only resources (ARV-113)

Some ids cannot be acquired through `discover` or `--seed` because they
**have no list/GET endpoint and no spec-described POST**. Typical shapes:

- **SDK-only ingest endpoints** — the resource is created through an
  endpoint with its own auth scheme (DSN, signed-URL, write-key) that
  isn't described in the OpenAPI spec at all.
- **Side-effect ids** — the value is produced as a byproduct of another
  call (e.g. an event-ingest call assigns a grouping id server-side).
- **Client-SDK-only resources** — produced by a browser/mobile SDK
  session and unreachable from a CLI HTTP client.
- **UI- or paid-plan-only resources** — OpenAPI describes only GET; the
  create path is dashboard-only.

**Workflow when prepare-fixtures reports `failed:miss-empty-no-seed-endpoint`:**

1. Read the failure reason — it names whether the owner has *no* create
   endpoint or *no* owner resource at all. `--seed` cannot help; do not
   keep re-running it.
2. If the resource is reachable via an out-of-spec ingest endpoint, you
   can harvest the id by hand:
   ```
   zond request POST <ingest-url> \
     --header "<auth-header>: <token>" \
     --header "Content-Type: application/json" \
     --body '<minimal payload>' \
     --json-path id
   ```
   Then write the captured value into `apis/<name>/.env.yaml`
   directly — see `feedback_env_yaml_editable` memory: `.env.yaml`
   holds **only values**, never secrets, so editing it is the
   sanctioned workaround.
3. **Persistent registration of custom endpoints** (ARV-111). When a
   write-only resource is needed across multiple runs, declare it in
   `apis/<name>/.api-resources.local.yaml` — a sibling file that survives
   `refresh-api`. Merged into the main resource map at read time;
   extensions with the same `resource` name override the spec-derived
   entry, which is how you teach `prepare-fixtures` about a create
   endpoint missing from OpenAPI. Schema (top-level `extensions:` array,
   each entry is a partial `ResourceYaml`):

   ```yaml
   # apis/<name>/.api-resources.local.yaml
   # Survives `zond refresh-api`. Add resources/endpoints not in OpenAPI.
   extensions:
     - resource: <resource-name>
       basePath: /<collection>
       itemPath: /<collection>
       idParam: id
       captureField: id
       hasFullCrud: false
       endpoints:
         create: POST /<collection>/
       fkDependencies:
         - var: <owner_id_var>
           param: <owner_id_param>
           in: path
           ownerResource: <owner-resource>
   ```

   Note (ARV-111 MVP): merge-only landed. The extension surfaces in the
   resource map and unblocks downstream tooling that consumes it, but
   `prepare-fixtures --seed` still requires the spec to carry the
   request-body schema for the create endpoint — so for true write-only
   ingest (a free-form event payload not described in OpenAPI), the
   `zond request` harvest + `.env.yaml` edit remains the workflow. A
   follow-up will extend the local file with an inline `requestBodyTemplate`
   so `--seed` can call the extension directly.

**Known dead-end shapes — do NOT add to the backlog:**

- Endpoints whose server-side validation rejects every value of a
  path/body field regardless of how it's encoded (slug vs numeric id
  etc.) — vendor-specific API quirks, not zond bugs. Move on or seed
  by hand via the vendor UI.
- Endpoints requiring a paid plan / scope you don't have — not a zond
  bug; the anti-FP `subscription-gated/paid-plan-403` rule already
  marks these as wontfix in probe summaries.
- Fixtures gated by SCIM provisioning, paid SSO, or data forwarders
  cannot be acquired through any CLI flow. Mark them with a placeholder
  in `.env.yaml` and document the gap in the case-study.

**Important — what `zond init` does NOT do.** `zond init` is **only** a
workspace refresher: it writes/updates `zond.config.yml`, `AGENTS.md`,
`.claude/skills/`, and the `apis/` directory marker. It does **not** touch
`.env.yaml`, does **not** rebuild manifests, does **not** call `doctor`
or `prepare-fixtures`. Re-running `zond init` after a CLI upgrade is safe
and *expected* (it picks up new skill files) — fixtures stay exactly as
they were. The loop above is the only path that fills `.env.yaml`.

**Important — what `zond add api` DOES do for fixtures.** Registers the
API, copies `spec.json`, and emits `.api-fixtures.yaml` (manifest) +
seeds a skeleton `.env.yaml` with empty placeholders for every required
var. Values are still empty — `doctor` will report them all as UNSET
until you run `prepare-fixtures --apply` (or fill them by hand).

### Editing `.env.yaml` directly — when it's the right move (ARV-114)

`.env.yaml` stores **only values** (no secrets — those live in
`.secrets.yaml`, gitignored, referenced via `@secret:`). Editing it
directly is the sanctioned fallback in autonomous/user-mode whenever the
CLI cannot harvest a value, specifically:

- a write-only / SDK-only id from a non-spec ingest endpoint (see
  Write-only section above)
- a value `prepare-fixtures` mis-derived (e.g. picked up a built-in
  resource id when the test needed a user-owned one — see ARV-112's
  `sourceEndpoint` field to spot this) and `--verify` confirms it's stale
- an `environment` / slug / region value that the API doesn't expose via
  any list endpoint and that lives only in the user's project config

**Rules when you do edit:**

1. Touch values only. Never add a key that's not in `.api-fixtures.yaml`
   (manifest) — the next `prepare-fixtures` will warn `not in manifest,
   ignored`. If the manifest is missing a var, fix the manifest builder,
   not `.env.yaml`.
2. Never edit `.api-*.yaml` (manifest / catalog / resources) by hand —
   those are regenerated by `refresh-api` and your edits will be lost.
3. State what you did in the run summary so the loop's feedback artefacts
   can capture it (a future ARV-111 extend-CLI will replace the manual
   edit with a tracked one).

The `.env.yaml` ownership row in the file-roles table (`zond.md`) says
"owner: the user" — that's about garbage-collection (zond won't `clean`
it), not a permission boundary. The agent may write it whenever the
above rules are met.

## Cross-cutting iron rules

These apply to every sibling skill. The siblings extend with their own
rules; never override these.

### Secrets & identity

- **NEVER hardcode tokens.** Put them in `apis/<name>/.secrets.yaml`
  (auto-gitignored), reference from `.env.yaml` as `@secret:auth_token`.
  Tests read the resolved value as `{{auth_token}}`.
- **NEVER read `.secrets.yaml` directly** — use `zond doctor --api <name>
  --json` (reports `set | unset` and value length only).
- **NEVER share triage artefacts** (case-study, html, bundle, digest)
  outside the user's org without `--redact-identity`. Identity-file
  values (org/member/project slugs, real ids) leak otherwise; the
  redaction registry only catches secrets, not identifying metadata.

### Destructive ops

- **NEVER run destructive ops on a shared / production org without
  `--dry-run` first.** Probes, `prepare-fixtures --apply`, and `cleanup`
  hit live APIs and can delete user data. Always `--dry-run` once,
  inspect, then drop the flag.
- **MUST timeout the cascade at 8 passes.** `zond prepare-fixtures
  --cascade [--seed]` chains discover and POST-creates; the loop can
  self-trigger on partially-resolved fixtures. The CLI bounds it; never
  override without a written reason.
- **NEVER report a cleanup failure as an API bug.** A POST that 200-OKs
  followed by a DELETE that 5xx-es is *probably* a fixture-isolation
  issue (orphan accumulation, race), not an API contract bug. Re-run
  with `--no-cleanup` or in an isolated namespace before filing.

### HTTP & ad-hoc requests

- **NEVER `curl` or `wget`.** Use `zond request <method> <url> --api <name>`
  for ad-hoc HTTP — it lands in the run DB and respects auth. Never
  shell-substitute the token by hand (`$(yq …)` is also blocked by the
  sandbox).
- **NEVER read raw OpenAPI/swagger** with `Read`/`cat`/`grep`. The
  workspace has pre-built artifacts (catalog/resources/fixtures); use
  those. Drop into `spec.json` only when probe-* needs full schemas.

### Triage

- **`recommended_action: report_backend_bug` / any 5xx → STOP.** Surface
  the request/response excerpt to the user; do **not** edit `expect:` to
  mask it.
- **CRUD-run with ≥80% 401/403 / `permission_denied` → `env_issue`, not
  bug.** It's a missing token scope, not an API bug. Confirm via
  `zond db diagnose <run-id> --env-only`; do not generate case-studies.
- **MUST run `zond doctor --api <name> --missing-only` before generating
  fixtures or touching `.env.yaml`.** It identifies unfilled keys
  before workflow blows up midway.

## --json envelope (for CI / agent consumption)

Every command with `--json` returns the same shape (TASK-184, build-time
contract test in m-17 ARV-57):

```json
{
  "ok": true|false,
  "command": "<command name>",
  "data": { /* command-specific payload */ },
  "warnings": [{ "code": "...", "message": "..." }],
  "errors": [{ "code": "...", "message": "..." }],
  "exit_code": 0|1|2
}
```

**Stdout discipline:** when `--json` is set, stdout contains **only**
the envelope. All human-readable progress goes to stderr. Pipe-friendly:
`zond run --json | jq '.data.runs[]'`.

`--report json` is different: it's a per-test-case structured report
(used by `zond run`, `zond checks`, `zond probe`). The `--json` flag
wraps the **command result**; `--report json` wraps the **test-run
artefact**. Don't conflate.

## Common commands cheat-sheet

```bash
zond --version
zond add api <name> --spec <path|url>      # register API, build artifacts
zond doctor --api <name>                   # health: missing fixtures, drift
zond prepare-fixtures --api <name>         # discover values for manifest entries
zond prepare-fixtures --api <name> --cascade --seed --apply
                                            # create resources via POST when discover fails
zond generate --api <name>                 # autogen smoke + CRUD suites
zond run apis/<name>/tests --api <name>    # run all suites for the API
zond coverage --api <name>                 # endpoint coverage report
zond db diagnose --api <name>              # last-run failure triage
```

For depth-check workflows, see `zond-checks`. For scenario authoring,
see `zond-scenarios`. For an end-to-end macro, see `zond audit --api
<name>` (covered in the `zond` skill).

## Hand-off

Once you know what the user wants:

- "find bugs in the whole API" / "full audit" / "raise coverage" → `zond`
- "verify this specific user flow" / "write a scenario for X" → `zond-scenarios`
- "what failed in the last run" / "why is it red" → `zond-triage`
- "depth checks" / "schemathesis-style" / "SARIF" / "boundary values" →
  `zond-checks`

If the user is mid-workflow, do **not** restart from this skill — let the
active sibling continue.
