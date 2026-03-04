# @kirrosh/zond

Point your AI agent at an OpenAPI spec. Get working tests in minutes. No config, no cloud, no Postman.

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=zond&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBraXJyb3NoL2FwaXRvb2wiLCJtY3AiXX0=)

## Claude Code Plugin

Install in Claude Code:

```
/plugin marketplace add kirrosh/zond
/plugin install zond@zond-marketplace
```

This gives you:
- **17 MCP tools** for API testing (test generation, execution, diagnostics, coverage)
- **Skills** for test generation, debugging failures, and CI setup
- **Slash commands**: `/zond:api-test`, `/zond:api-coverage`

After installation, just say: _"Safely cover the API from openapi.json with tests"_ — the agent handles everything.

## Install

```bash
# Option 1: via npx (recommended — works everywhere with Node.js)
npx -y @kirrosh/zond --version

# Option 2: Binary (no Node.js required)
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh

# Windows
iwr https://raw.githubusercontent.com/kirrosh/zond/master/install.ps1 | iex
```

[All releases](https://github.com/kirrosh/zond/releases) (Linux x64, macOS ARM, Windows x64)

## MCP Setup (Cursor / Claude Code / Windsurf)

Click the badge above, or add manually:

```json
{
  "mcpServers": {
    "zond": {
      "command": "npx",
      "args": [
        "-y",
        "@kirrosh/zond@latest",
        "mcp",
        "--dir",
        "${workspaceFolder}"
      ]
    }
  }
}
```

> `@latest` ensures npx always pulls the newest version on each restart — no manual update needed.

**Where to put this:**

| Editor      | Config file                                           |
| ----------- | ----------------------------------------------------- |
| Cursor      | Settings > MCP, or `.cursor/mcp.json` in project root |
| Claude Code | `.mcp.json` in project root                           |
| Windsurf    | `.windsurfrules/mcp.json` or settings                 |

## Main Flow (5 steps)

Once MCP is connected, ask your AI agent to cover your API with tests:

**1. Register your API**

```
setup_api(name: "myapi", specPath: "openapi.json")
```

**2. Generate a test guide** (agent reads OpenAPI + gets instructions)

```
generate_and_save(specPath: "openapi.json")
```

For large APIs (>30 endpoints), auto-chunks by tags and returns a plan. Call with `tag` for each chunk.

**3. Save test suites** (agent writes YAML based on the guide)

```
save_test_suite(filePath: "apis/myapi/tests/smoke.yaml", content: "...")
```

**4. Run tests**

```
run_tests(testPath: "apis/myapi/tests/", safe: true)
```

**5. Diagnose failures**

```
query_db(action: "diagnose_failure", runId: 42)
```

Or just say: _"Safely cover the API from openapi.json with tests"_ — the agent will do all 5 steps.

## CLI

```
zond run <path>           Run tests (--env, --safe, --tag, --dry-run, --env-var, --report)
zond add-api <name>       Register API (--spec <openapi>)
zond coverage             API test coverage (--spec, --tests, --fail-on-coverage)
zond compare <runA> <runB> Compare two test runs
zond serve                Web dashboard with health strip + endpoints/suites/runs tabs (--port 8080)
zond mcp                  Start MCP server
zond chat                 AI chat agent (--provider ollama|openai|anthropic)
zond doctor               Diagnostics
```

## Documentation

- [docs/quickstart.md](docs/quickstart.md) — step-by-step quickstart guide (RU)
- [ZOND.md](ZOND.md) — full CLI and MCP tools reference
- [docs/mcp-guide.md](docs/mcp-guide.md) — MCP agent workflow guide
- [docs/ci.md](docs/ci.md) — CI/CD integration

## License

[MIT](LICENSE)
