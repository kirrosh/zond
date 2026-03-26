# zond

AI-powered API testing for Claude Code, Cursor, and CI/CD.

Say "test my API" — get working tests, coverage dashboard, and CI config in minutes.

<!-- TODO: add demo GIF (15 sec: plugin install → "cover openapi.json with tests" → 42/47 endpoints covered → dashboard) -->

Zond reads your OpenAPI spec and gives your AI agent everything it needs to test your API: structured tools, safety guardrails, coverage tracking, and run history. You don't need to learn anything new — just describe what you want and the agent handles the rest.

## Quick Start

```
/plugin marketplace add kirrosh/zond
/plugin install zond@zond-marketplace
```

Then say: _"Safely cover the API from openapi.json with tests"_

You get auto-validation hooks, CLI tools, and 8 MCP tools — all in one package.

<details>
<summary>Other installation methods (MCP, CLI, binary)</summary>

### MCP Server (Cursor, Windsurf, other editors)

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=zond&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBraXJyb3NoL3pvbmQiLCJtY3AiXX0K)

Or add manually — see [MCP setup guide](docs/mcp-guide.md) for Cursor, Claude Code, and Windsurf config.

### CLI / Binary

```bash
npx -y @kirrosh/zond --version

# Standalone binary (no Node.js required)
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh   # macOS/Linux
iwr https://raw.githubusercontent.com/kirrosh/zond/master/install.ps1 | iex        # Windows
```

See [ZOND.md](ZOND.md) for full CLI reference.

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

## Documentation

- [ZOND.md](ZOND.md) — full CLI and MCP tools reference
- [docs/mcp-guide.md](docs/mcp-guide.md) — MCP agent workflow guide
- [docs/quickstart.md](docs/quickstart.md) — step-by-step quickstart (RU)
- [docs/ci.md](docs/ci.md) — CI/CD integration

## License

[MIT](LICENSE)
