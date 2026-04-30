## API testing with zond

This workspace uses [zond](https://github.com/kirrosh/zond) for API testing — CLI
only, no MCP server in this workspace.

### Skills

- **`.claude/skills/zond-scenarios/SKILL.md` (default)** — when the user asks
  to verify a specific flow / business scenario. Hand-written multi-step
  YAML, runs and analyses one focused journey.
- **`.claude/skills/zond/SKILL.md`** — full audit: autogenerate from spec,
  run sanity → smoke → CRUD → probes → coverage → report. Use when asked
  for breadth (`audit my API`, `find bugs`, `coverage`, `5xx hunt`).

Both skills work off the per-API artifacts written by `zond add api`:

```
apis/<name>/
  spec.json              # dereferenced OpenAPI (machine source — only generators read it)
  .api-catalog.yaml      # endpoint index (cheap to read, agent-friendly)
  .api-resources.yaml    # CRUD chains, FK deps, ETag/soft-delete flags
  .api-fixtures.yaml     # required {{vars}} for .env.yaml
  .env.yaml              # user-supplied fixture values (auto-gitignored)
  tests/  scenarios/  probes/
```

### Setup flow

```bash
zond init                                              # bootstrap workspace
zond add api <name> --spec <path-or-url>               # register API + emit artifacts
zond doctor --api <name>                               # see which fixtures need filling
# user fills apis/<name>/.env.yaml
zond doctor --api <name>                               # re-check (exit 0 = ready)
```

`zond refresh-api <name> [--spec <new-source>]` re-snapshots when the upstream
spec changes.

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
