---
id: decision-7
title: API artifacts model + scenario/audit skill split
status: accepted (artifacts shipped); skill split deferred to next iteration
created_date: 2026-04-30
---

# Context

Until now, `zond init --spec X --name Y` created `apis/<name>/tests/` and stored
the **external spec path** in `collections.openapi_spec`. Every consumer
(`catalog`, `describe`, `guide`, `probe-*`, `generate`) re-fetched and
re-dereferenced that external spec on every call. Three problems:

1. **Hostage to user paths.** If the external spec moved, `--api <name>`
   broke silently.
2. **No git-tracked API source of truth.** Spec drift between runs was
   invisible — nothing in the workspace recorded what API shape we tested
   against.
3. **Skill cost.** The agent skill (one large 7-phase audit script) had to
   `Read` the raw OpenAPI to answer questions like "what resources exist",
   "what fixtures are needed", "how does auth work". On large APIs (Resend
   at 83 endpoints / ~80KB) this burned tokens unnecessarily.

The user explicitly framed the second feedback: "scenario tests are my
primary need; full audit is secondary. The skill should not have to read
the raw spec."

# Decision

Adopt a **pre-built artifact model** and a **two-skill split**.

## Artifact model (shipped in this branch)

When `zond init --spec X --name Y` runs, the workspace gets:

```
apis/<name>/
  spec.json              # dereferenced OpenAPI, copied locally — canonical machine source
  .api-catalog.yaml      # compressed endpoint index — human/agent-readable summary
  .api-resources.yaml    # CRUD chains, FK deps, ETag/soft-delete flags — for scenarios + setup
  .api-fixtures.yaml     # required {{vars}} classified by source (auth/server/path/header)
  .env.yaml              # user-facing fixture values (skeleton seeded from .api-fixtures.yaml)
  tests/                 # generated/handwritten test suites
  scenarios/             # (future) handwritten scenario suites
  probes/                # probe-generated suites (validation, methods, mass-assignment)
```

`collections.openapi_spec` now stores the **workspace-relative** path
(`apis/<name>/spec.json`), so the workspace is portable. A new helper
`resolveCollectionSpec()` (in `src/core/setup-api.ts`) handles legacy
absolute paths and URLs for backward compatibility.

### What each artifact is for

| File | Purpose | Read by |
|---|---|---|
| `spec.json` | Authoritative dereferenced source. Copied into workspace so generators don't depend on external paths. | `catalog`, `describe`, `guide`, `probe-*`, `generate` (via `resolveCollectionSpec`) |
| `.api-catalog.yaml` | Human-readable index: method, path, summary, params with types, compressed schemas. **Compressed strings**, not full schemas — cheap to read but **not** sufficient for code generation. | scenarios skill, audit skill, agent's `Read` calls |
| `.api-resources.yaml` | CRUD chain map. Each resource has list/create/read/update/delete endpoints, idParam, captureField, hasFullCrud flag, requiresEtag, fkDependencies, plus orphanEndpoints (action/RPC routes). Built from `detectCrudGroups()` + best-effort FK resolution by name. | scenarios skill (planning setup chains, picking what to test) |
| `.api-fixtures.yaml` | Read-only manifest of every var the API needs in `.env.yaml`, grouped by source (server, auth, path, header) with descriptions, defaults, and affected-endpoints lists. | future `zond doctor`; scenarios skill (asking the user what's missing) |

### Artifact regeneration

Currently regenerated only at register time. **TODO** for next iteration:

- `zond refresh-api <name>` — single command to re-fetch + re-snapshot +
  re-emit all four artifacts when the upstream spec changes.
- `zond run` (and other consumers) cross-check `specHash` from
  `.api-catalog.yaml` against the local `spec.json`; if they diverge,
  warn that artifacts are stale.

## Skill split (deferred — do in next iteration)

Today's `src/cli/commands/init/templates/skills/zond.md` is one 350-line
7-phase skill. It conflates "I want to verify a specific scenario" with
"I want to fully audit this API". For a backend-with-known-bugs context,
the audit phases are noise.

### Three-skill layout (target)

```
zond-base (always loaded)
  ├─ workspace concepts (zond.config.yml, apis/<name>/, .env.yaml)
  ├─ artifact model (spec.json, .api-catalog.yaml, .api-resources.yaml, .api-fixtures.yaml)
  ├─ session lifecycle (zond session start/end)
  ├─ run/diagnose/report basics
  └─ "before you read raw spec, check artifacts" rule

zond-scenarios (default; ~50 lines)
  ├─ entry: "user has a specific flow to verify"
  ├─ phase 1: read .api-resources.yaml, find the chain
  ├─ phase 2: read .api-fixtures.yaml, ensure .env.yaml has needed vars
  ├─ phase 3: scaffold scenario YAML (TODO: zond scenario new <name>)
  ├─ phase 4: run + capture + iterate
  └─ NEVER reads raw spec.json directly

zond-audit (on demand; current 7-phase skill, trimmed)
  ├─ entry: "user asked for full audit / safety review / coverage"
  ├─ phases 1-7 from current skill (sanity → smoke → CRUD → probes → coverage → report)
  ├─ uses .api-catalog.yaml + .api-resources.yaml as primary references
  └─ may dip into spec.json for probe-* generator inputs (full schemas required)
```

### Trigger model

`zond init` (or future `zond add api`) ends with one prompt-line:

> Workspace ready. What now?
> - **scenarios** — write tests for a specific flow you care about
> - **audit** — full sweep (generate + lint-spec + probes + coverage)
> - **skip** — I'll author manually

That choice picks which skill the agent loads.

### Reading rules (enforced by skill prose)

1. **First read** `.api-catalog.yaml` for endpoint shape.
2. **Second read** `.api-resources.yaml` for CRUD chains.
3. **Third read** `.api-fixtures.yaml` for env-var requirements.
4. **Only if a probe needs full schemas** read `spec.json`.
5. **NEVER `Read` an external spec path directly** — always go through the local `spec.json`.

If the agent finds itself wanting to grep raw OpenAPI, that's a signal to
add a query to one of the artifacts (or, if novel, propose a new artifact).

## Multi-service scenarios (deferred)

For "login → create order → charge billing" across N services, the
short-term answer is `services.<name>.base_url` keys in `.env.yaml` with
suite steps interpolating `{{services.users}}/login` etc. No code change.

Long-term: per-step `base_url:` override in suite YAML — small parser +
executor change. Decide when the env-var pattern proves insufficient.

# Consequences

## Removed

- DB tables `ai_generations`, `chat_sessions`, `chat_messages` (schema
  v7→v8). Plus their queries / interfaces / tests. They were a never-shipped
  in-app chat experiment with zero consumers.

## Added (this branch)

- `apis/<name>/spec.json` snapshot at register time.
- Three new artifacts at register time.
- `resolveCollectionSpec()` for portable spec lookup.
- `core/generator/resources-builder.ts`, `core/generator/fixtures-builder.ts`.

## Carried forward (next iteration)

- `zond refresh-api <name>` command.
- `specHash` staleness check in `zond run` / `zond scenario new`.
- `zond scenario new <name>` scaffold command.
- Skill split: `zond-base` + `zond-scenarios` + `zond-audit`.
- `zond doctor` (or extend `zond use`) — surface fixture gaps in human form.
- Optional: per-step `base_url` override.

# Non-goals for this iteration

- Don't autogenerate tests at register time. Generation is opt-in via
  `zond generate` or part of `zond audit` (future).
- Don't auto-pull spec from URL on every `run`. Local snapshot is the
  truth between explicit refreshes.
- Don't replace `.api-catalog.yaml` with a heavier "full schemas" file.
  The catalog stays as the human-readable index; full schemas live in
  `spec.json` for machine consumers only.
