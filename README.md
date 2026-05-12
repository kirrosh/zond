# zond

AI-powered API testing for Claude Code, Cursor, and CI/CD.

Say "test my API" — get working tests, coverage dashboard, and CI config in minutes.

Zond reads your OpenAPI spec and gives your AI agent everything it needs to test your API: a focused CLI, safety guardrails, coverage tracking, and run history. You don't need to learn anything new — just describe what you want and the agent runs `zond` commands.

## Quick Start

Install the binary (no Node.js required):

```bash
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh   # macOS/Linux
iwr https://raw.githubusercontent.com/kirrosh/zond/master/install.ps1 | iex        # Windows
```

Bootstrap a workspace, register your first API, then fill its fixtures:

```bash
zond init                                              # bootstrap workspace (no fixture changes)
zond add api my-api --spec ./openapi.json              # register: copies spec.json + emits manifest
zond doctor --api my-api --missing-only                # gap report: which vars are UNSET
zond prepare-fixtures --api my-api --apply [--seed]    # fill apis/my-api/.env.yaml from live API
```

`zond init` writes a self-contained [`AGENTS.md`](AGENTS.md) and Claude Code
skills — agents read it and use the CLI directly (`zond run`,
`zond probe static`, `zond db diagnose`, …). No daemon, no transport, no
extra configuration. `init` is workspace-only — it never touches
`.env.yaml`; the fixture loop above is the canonical path.

Each registered API gets four files in `apis/<name>/`:

- `spec.json` — dereferenced OpenAPI snapshot (canonical machine source).
- `.api-catalog.yaml` — endpoint index for agents (cheap to read).
- `.api-resources.yaml` — CRUD chains, FK dependencies, ETag/soft-delete flags.
- `.api-fixtures.yaml` — **manifest** of required `{{vars}}` (read-only, auto-generated).

Plus a sibling `.env.yaml` that you (or `zond prepare-fixtures`) fill with
the **values** for those vars. The manifest/values split is strict — see
the [workspace contract](AGENTS.md#workspace-contract) for details.

Run `zond refresh-api <name> [--spec <new-source>]` to re-snapshot when the
upstream spec changes.

Then say to your agent: _"Safely cover the API from openapi.json with tests."_

Want the whole pipeline at once? `zond audit --api my-api` runs
prepare-fixtures → generate → probes → run → coverage → HTML report in a
single shot.

<details>
<summary>Other installation methods (npx)</summary>

```bash
npx -y @kirrosh/zond --version
```

See [ZOND.md](ZOND.md) for the full CLI reference.

</details>

## What Happens

1. **Point** — you give the agent an OpenAPI spec
2. **Generate** — zond reads the spec, produces YAML test suites (smoke + CRUD)
3. **Run** — tests execute, failures are diagnosed, coverage is tracked

The agent does all three steps autonomously. It asks you only when it needs an auth token or permission to run write operations.

## Why Not Just Ask Claude to Write pytest?

Claude Code can write pytest from scratch — but it takes 30-60 minutes per flow, has no safety guardrails, no coverage tracking, and no run history. Zond gives the agent structured tools to do it in 5 minutes with full visibility.

## Key Capabilities

| | |
|---|---|
| **Safe by Default** | `--safe` runs only GET requests. `--dry-run` previews without sending. The agent never touches production data without your explicit approval. |
| **Spec-Grounded** | Tests are derived from your OpenAPI schema, not invented from scratch. The spec is the source of truth. |
| **Full Visibility** | Every run is stored in SQLite. Compare runs, track regressions, see exactly what the server returned. |
| **Coverage Tracking** | See which endpoints are tested, which aren't, and what broke since last run. |
| **Schema Validation** | `--validate-schema` checks every JSON response against the OpenAPI schema (types, required, enum, format, `$ref`) — catches contract drift the YAML expectations miss. |
| **Spec Linting** | `zond check spec` static-analyses the OpenAPI document for internal-consistency bugs (e.g. example violates `format: date-time`) and strictness gaps (path-params without `format`, integer params without min/max) — surfaces issues before any HTTP request. |
| **Depth Checks (m-15)** | `zond checks run` runs a schemathesis-style catalog of conformance + security probes (`status_code_conformance`, `negative_data_rejection`, `ignored_auth`, `use_after_free`, …) — boundary-value coverage, broken-auth detection, soft-deleted resource leaks. Every finding ships with a `recommended_action` enum so the agent triages without parsing messages. |
| **SARIF for Code Scanning** | `--report sarif` emits SARIF v2.1.0 with stable `partialFingerprints` — drop-in for `github/codeql-action/upload-sarif@v3` so depth-checks findings show up in GitHub's Security tab. |
| **Concurrent Workers** | `--workers auto` parallelizes runs at the operation level (bounded async-pool, no threading) — runs that took minutes finish in seconds. Pair with `--rate-limit` to stay within an API's RPS budget. |
| **CI-Ready** | One command generates GitHub Actions or GitLab CI workflow. Tests in YAML, in git, with code review. |

## Try It

```
"Cover openapi.json with tests"
"Run only smoke tests against staging"
"What broke since last run?"
"Set up CI for API tests"
```

## Upgrading

`zond update` was removed in favour of system package managers:

```bash
# macOS / Linux — re-run the installer
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh

# npm
npm install -g @kirrosh/zond@latest

# bun
bun install -g @kirrosh/zond@latest
```

## Shell completions

```bash
zond completions bash > ~/.local/share/bash-completion/completions/zond
zond completions zsh  > ~/.zsh/completions/_zond   # then `compinit`
zond completions fish > ~/.config/fish/completions/zond.fish
```

## Documentation

- [ZOND.md](ZOND.md) — full CLI reference
- [docs/quickstart.md](docs/quickstart.md) — step-by-step quickstart (RU)
- [docs/ci.md](docs/ci.md) — CI/CD integration
- [backlog/](backlog/) — project tasks (powered by [Backlog.md](https://backlog.md))

## License

[MIT](LICENSE)
