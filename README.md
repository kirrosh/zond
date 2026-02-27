# apitool

API testing platform — define tests in YAML, run from CLI or WebUI, generate from OpenAPI specs.

## Features

- **Declarative YAML tests** — readable, version-controlled API test suites
- **Variable substitution** — environments, captures, built-in generators (`$randomName`, `$randomEmail`)
- **Chained requests** — capture values from responses and use them in subsequent steps
- **Rich assertions** — status codes, JSON body (exact, contains, path, regex), headers, response time
- **OpenAPI generator** — auto-generate skeleton tests from OpenAPI 3.x specs
- **AI test generation** — generate tests using LLM providers (Ollama, OpenAI, Anthropic)
- **Multiple reporters** — console (colored), JSON, JUnit XML
- **Web dashboard** — run history, trend charts, API Explorer, collection management
- **SQLite storage** — persist runs and results locally
- **Standalone binary** — single executable, no runtime dependencies

## Installation

### Download binary

Download the latest release for your platform from [GitHub Releases](https://github.com/anthropics/apitool/releases).

```bash
# Linux / macOS
chmod +x apitool
./apitool --version

# Windows
apitool.exe --version
```

### From source (requires Bun)

```bash
git clone https://github.com/anthropics/apitool.git
cd apitool
bun install
bun run apitool --version
```

### Build standalone binary

```bash
bun run build    # produces ./apitool (or apitool.exe on Windows)
```

## Quick Start

### 1. Create a test file

```yaml
# tests/health.yaml
name: Health Check
base_url: https://jsonplaceholder.typicode.com

tests:
  - name: "List posts"
    GET: /posts
    expect:
      status: 200
      body:
        - id: { type: integer }
```

### 2. Run tests

```bash
apitool run tests/health.yaml
```

### 3. Start web dashboard

```bash
apitool serve --port 8080
# Open http://localhost:8080
```

## YAML Test Format

```yaml
name: Users CRUD
base_url: "{{base}}"
headers:
  Authorization: "Bearer {{token}}"
  Content-Type: application/json

config:
  timeout: 10000
  retries: 1

tests:
  - name: "Create user"
    POST: /users
    json:
      name: "{{$randomName}}"
      email: "{{$randomEmail}}"
    expect:
      status: 201
      body:
        id: { capture: user_id, type: integer }
        name: { type: string }
      duration: 2000

  - name: "Get created user"
    GET: /users/{{user_id}}
    expect:
      status: 200
      body:
        id: { equals: "{{user_id}}" }
        email: { matches: ".+@.+" }

  - name: "Delete user"
    DELETE: /users/{{user_id}}
    expect:
      status: 204
```

## Environment Files

Create `.env.<name>.yaml` files for per-environment configuration:

```yaml
# .env.dev.yaml
base: http://localhost:3000
token: dev-token-123
```

```bash
apitool run tests/ --env dev
```

## CLI Reference

```
apitool run <path>                Run API tests
apitool validate <path>           Validate test files without running
apitool generate --from <spec>    Generate skeleton tests from OpenAPI spec
apitool ai-generate --from <spec> --prompt "..."  Generate tests with AI
apitool collections               List test collections
apitool serve                     Start web dashboard
```

### Run options

| Flag | Description |
|------|-------------|
| `--env <name>` | Use environment file (`.env.<name>.yaml`) |
| `--report <format>` | Output format: `console`, `json`, `junit` |
| `--timeout <ms>` | Override request timeout |
| `--bail` | Stop on first suite failure |
| `--no-db` | Do not save results to database |
| `--db <path>` | Path to SQLite database file |
| `--auth-token <token>` | Auth token injected as `{{auth_token}}` |

### Serve options

| Flag | Description |
|------|-------------|
| `--port <port>` | Server port (default: 8080) |
| `--host <host>` | Server host (default: 0.0.0.0) |
| `--openapi <spec>` | Path to OpenAPI spec for Explorer |
| `--db <path>` | Path to SQLite database file |

## Generate Tests from OpenAPI

```bash
# Skeleton tests
apitool generate --from petstore.yaml

# AI-powered generation
apitool ai-generate --from petstore.yaml \
  --prompt "Generate CRUD tests for the Pet endpoints" \
  --provider openai --model gpt-4o
```

## License

[MIT](LICENSE)
