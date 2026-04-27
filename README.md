# zond

AI-powered API testing for Claude Code, Cursor, and CI/CD.

Say "test my API" — get working tests, coverage dashboard, and CI config in minutes.

<!-- TODO: add demo GIF (15 sec: zond install --claude → "cover openapi.json with tests" → 42/47 endpoints covered → dashboard) -->

Zond reads your OpenAPI spec and gives your AI agent everything it needs to test your API: structured tools, safety guardrails, coverage tracking, and run history. You don't need to learn anything new — just describe what you want and the agent handles the rest.

## Quick Start

Install the binary (no Node.js required):

```bash
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh   # macOS/Linux
iwr https://raw.githubusercontent.com/kirrosh/zond/master/install.ps1 | iex        # Windows
```

Wire it into your AI client (writes/merges `~/.claude/mcp.json` and/or `~/.cursor/mcp.json`):

```bash
zond install --claude          # Claude Code
zond install --cursor          # Cursor
zond install --all             # both
```

Restart your client, then say: _"Safely cover the API from openapi.json with tests."_ The agent picks up zond's MCP tools (`zond_run`, `zond_diagnose`, …) and resources (`zond://workflow/test-api`, …) automatically.

<details>
<summary>Other installation methods (npx, manual MCP config)</summary>

```bash
npx -y @kirrosh/zond --version
```

If you'd rather edit MCP config by hand, point your client's `mcpServers` at:

```json
{ "mcpServers": { "zond": { "command": "zond", "args": ["mcp", "start"] } } }
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
| **CI-Ready** | One command generates GitHub Actions or GitLab CI workflow. Tests in YAML, in git, with code review. |

## Try It

```
"Cover openapi.json with tests"
"Run only smoke tests against staging"
"What broke since last run?"
"Set up CI for API tests"
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
- [backlog/](backlog/) — project tasks (powered by [Backlog.md](https://backlog.md), see [docs/backlog.md](docs/backlog.md))

## License

[MIT](LICENSE)
