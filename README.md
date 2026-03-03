# @kirrosh/apitool

AI-native API testing tool. OpenAPI spec in, tests out. One binary, zero config.

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=apitool&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBraXJyb3NoL2FwaXRvb2wiLCJtY3AiXX0=)

## Install

```bash
# Option 1: via npx (recommended — works everywhere with Node.js)
npx -y @kirrosh/apitool --version

# Option 2: Binary (no Node.js required)
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh

# Windows
iwr https://raw.githubusercontent.com/kirrosh/apitool/master/install.ps1 | iex
```

[All releases](https://github.com/kirrosh/apitool/releases) (Linux x64, macOS ARM, Windows x64)

## MCP Setup (Cursor / Claude Code / Windsurf)

Click the badge above, or add manually:

```json
{
  "mcpServers": {
    "apitool": {
      "command": "npx",
      "args": ["-y", "@kirrosh/apitool@latest", "mcp", "--dir", "${workspaceFolder}"]
    }
  }
}
```

> `@latest` ensures npx always pulls the newest version on each restart — no manual update needed.

**Where to put this:**

| Editor | Config file |
|--------|-------------|
| Cursor | Settings > MCP, or `.cursor/mcp.json` in project root |
| Claude Code | `.mcp.json` in project root |
| Windsurf | `.windsurfrules/mcp.json` or settings |

## Main Flow (5 steps)

Once MCP is connected, ask your AI agent to cover your API with tests:

**1. Register your API**
```
setup_api(name: "myapi", specPath: "openapi.json")
```

**2. Generate a test guide** (agent reads OpenAPI + gets instructions)
```
generate_tests_guide(specPath: "openapi.json")
```

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

Or just say: *"Safely cover the API from openapi.json with tests"* — the agent will do all 5 steps.

## CLI

```
apitool run <path>           Run tests (--env, --safe, --tag, --dry-run, --env-var, --report)
apitool add-api <name>       Register API (--spec <openapi>)
apitool coverage             API test coverage (--spec, --tests, --fail-on-coverage)
apitool compare <runA> <runB> Compare two test runs
apitool serve                Web dashboard (--port 8080)
apitool mcp                  Start MCP server
apitool chat                 AI chat agent (--provider ollama|openai|anthropic)
apitool doctor               Diagnostics
```

## Documentation

- [APITOOL.md](APITOOL.md) — full CLI and MCP tools reference
- [docs/mcp-guide.md](docs/mcp-guide.md) — MCP agent workflow guide
- [docs/ci.md](docs/ci.md) — CI/CD integration

## License

[MIT](LICENSE)
