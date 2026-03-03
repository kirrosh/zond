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

## Quick Start

```bash
# Register API + generate + run — all in one flow via MCP or CLI
apitool add-api petstore --spec https://petstore.swagger.io/v2/swagger.json
apitool run apis/petstore/tests/ --env default
apitool serve   # web dashboard at http://localhost:8080
```

Or let your AI agent do it — just say: *"Test the API from openapi.json"*

## MCP Setup (Cursor / Claude Code / Windsurf)

Click the badge above, or add manually:

```json
{
  "mcpServers": {
    "apitool": {
      "command": "npx",
      "args": ["-y", "@kirrosh/apitool", "mcp", "--dir", "${workspaceFolder}"]
    }
  }
}
```

**Where to put this:**

| Editor | Config file |
|--------|-------------|
| Cursor | Settings > MCP, or `.cursor/mcp.json` in project root |
| Claude Code | `.mcp.json` in project root |
| Windsurf | `.windsurfrules/mcp.json` or settings |

14 MCP tools: `setup_api`, `generate_tests_guide`, `save_test_suite`, `run_tests`, `query_db`, `explore_api`, `coverage_analysis`, `generate_missing_tests`, `validate_tests`, `send_request`, `manage_environment`, `manage_server`. Full reference in [APITOOL.md](APITOOL.md).

## YAML Test Format

```yaml
name: Users CRUD
description: Full user lifecycle
tags: [users, crud, smoke]
base_url: "{{base_url}}"

tests:
  - name: Create user
    POST: /users
    json:
      name: "{{$randomName}}"
      email: "{{$randomEmail}}"
    expect:
      status: 201
      body:
        id: { capture: user_id, type: integer }

  - name: Get user
    GET: /users/{{user_id}}
    expect:
      status: 200

  - name: Delete user
    DELETE: /users/{{user_id}}
    expect:
      status: 204
```

## CLI

```
apitool run <path>           Run tests (--env, --safe, --report json|junit)
apitool add-api <name>       Register API (--spec <openapi>)
apitool serve                Web dashboard (--port 8080)
apitool mcp                  Start MCP server
apitool coverage             API test coverage (--spec, --tests)
apitool chat                 AI chat agent (--provider ollama|openai|anthropic)
apitool doctor               Diagnostics
```

Full docs: [APITOOL.md](APITOOL.md)

## License

[MIT](LICENSE)
