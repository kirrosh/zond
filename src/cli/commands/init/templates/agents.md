## API testing with zond

This workspace uses [zond](https://github.com/kirrosh/zond) for API testing — CLI
only, no MCP server in this workspace.

### Skills

- **`.claude/skills/zond/SKILL.md` (primary)** — artifact model + iron
  rules + full workflow: fixtures → annotate → generate → smoke → CRUD
  → stateful checks → probes → coverage → report, plus single-flow
  scenario authoring. Loads on workspace touch and on intent ("audit
  this API", "find bugs", "write a test for X flow").
- **`.claude/skills/zond-checks/SKILL.md`** — depth-check reference:
  conformance + security + m-20 stateful invariants
  (cross_call_references, idempotency_replay, pagination_invariants,
  lifecycle_transitions) and the `zond api annotate dump+apply` flow.
- **`.claude/skills/zond-triage/SKILL.md`** — read-only triage of a
  finished run / probe artifact. Routes by `recommended_action` enum.

Both skills work off the per-API artifacts written by `zond add api`:

```
apis/<name>/
  spec.json              # dereferenced OpenAPI (machine source — only generators read it)
  .api-catalog.yaml      # endpoint index (cheap to read, agent-friendly)
  .api-resources.yaml    # CRUD chains, FK deps, ETag/soft-delete flags
  .api-fixtures.yaml     # MANIFEST: required {{vars}} (read-only, auto-generated)
  .env.yaml              # VALUES: variable values (user-edited; auto-gitignored)
  tests/  scenarios/  probes/
```

`.api-fixtures.yaml` is the **manifest** (single source of truth for the
list of vars an API needs) and `.env.yaml` holds their **values**. Don't
add a key to `.env.yaml` that's not in the manifest — it'll be warned and
ignored. A missing entry in the manifest is a generator/manifest bug, not
an env fix.

### Setup flow

```bash
zond init                                              # bootstrap workspace (no fixture changes)
zond add api <name> --spec <path-or-url>               # register API + emit manifest + seed empty .env.yaml
zond doctor --api <name> --missing-only                # gap report: which vars are UNSET
zond prepare-fixtures --api <name>                     # gap report: verify + which FK vars need a value
# → fill each gap yourself: `zond fixtures add` / edit .env.yaml (you pick the value)
zond doctor --api <name>                               # re-check (exit 0 = ready)
```

What each step does to `.env.yaml`:

| Command | Touches `.env.yaml`? |
|---|---|
| `zond init` | no — only writes workspace/skills files |
| `zond add api` | seeds skeleton with empty placeholders for every required var |
| `zond doctor` | no — read-only diagnostic |
| `zond prepare-fixtures` | no — reports gaps only; **never harvests a value** (which record/field fills a slot is your call) |
| `zond prepare-fixtures --refresh` | unsets stale (404) ids so they resurface as gaps (`.bak` backup); does not re-resolve |
| `zond fixtures add` / `import` | writes the value you supply (`.bak` backup) |
| `zond refresh-api` | no — only re-snapshots `spec.json` and rebuilds the manifest |

`zond refresh-api <name> [--spec <new-source>]` re-snapshots when the upstream
spec changes.

**Re-running `zond init`** is safe and expected after a CLI upgrade: it
re-emits skills/AGENTS.md/zond.config.yml only. Fixtures stay exactly as
they were — never relies on init to fill `.env.yaml`.

### Mandatory rules (mirrored from the skills — non-negotiable)

- **NEVER read raw OpenAPI/Swagger** with Read/cat/grep — use the artifacts
  in `apis/<name>/.api-*.yaml`. Drop into `spec.json` only when a probe
  generator needs full schemas.
- **NEVER use curl/wget** — use `zond request <method> <url>` for ad-hoc HTTP.
- **NEVER write test YAML from scratch for autogen flows** — start with
  `zond generate`, then edit failures. (Hand-written YAML is fine for
  scenarios.)
- **NEVER hardcode tokens** — `apis/<name>/.env.yaml` (auto-gitignored),
  reference as `{{auth_token}}`.
- **`recommended_action: report_backend_bug` (5xx) → STOP**, do not edit
  assertions to make the test pass.
