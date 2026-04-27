## API testing with zond

This workspace uses [zond](https://github.com/kirrosh/zond) for API testing. The MCP
server is **not** configured for this workspace, so use the CLI directly.

### Mandatory rules (always-on)

- **NEVER** read OpenAPI/Swagger/JSON spec files with Read/cat — use `zond describe`,
  `zond catalog`, or the generated `.api-catalog.yaml`.
- **NEVER** use curl/wget for ad-hoc requests — use `zond request <method> <url>`.
- **NEVER** write test YAML from scratch — start with `zond generate <spec> --output <dir>`,
  then edit failing cases.
- **NEVER** hardcode tokens — put them in `apis/<name>/.env.yaml` (already gitignored)
  and reference as `{{auth_token}}` in test YAML.
- `--safe` enforces GET-only; never run CRUD tests against production without explicit
  user confirmation and a staging environment.
- When `zond db diagnose` reports `recommended_action: report_backend_bug` — STOP, do
  not change the test to make it pass.

### Workflow — covering an API end-to-end

```bash
# 1. Register the API
zond init --spec <path-or-url> --name <name> [--base-url <url>]
zond use <name>                              # remember as current

# 2. Inspect endpoints (avoid reading the raw spec)
zond catalog <spec> --output apis/<name>     # writes .api-catalog.yaml
zond describe <spec> --compact

# 3. Generate test stubs and run smoke (GET-only)
zond generate <spec> --output apis/<name>/tests --tag smoke
zond run --safe --json

# 4. Diagnose failures
zond db runs --limit 5
zond db diagnose <run-id> --json

# 5. Coverage gate
zond coverage --fail-on-coverage 50

# 6. CRUD only with explicit user confirmation + staging env
zond run --tag crud --dry-run                # show what would be sent
zond run --tag crud --env staging
```

### Filtering by tag

`--tag <name>` filters suites. If a `setup` suite primes auth tokens, always include
its tag together with the target group: `--tag crud,setup`.

### Auth patterns

For in-memory or test backends that issue tokens via login, use a `setup.yaml` suite
with `setup: true`. Captured variables (e.g. `auth_token`) propagate to subsequent
suites in the same run. Do NOT hardcode bearer tokens for these flows.

### Environments

`zond run --env <name>` loads `.env.<name>.yaml` (or `.env.yaml` by default) from the
API directory. Environment files are auto-gitignored by `zond init`.
