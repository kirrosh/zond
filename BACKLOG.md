# Backlog

## High Priority

### CI/CD Improvements
- **`--fail-on-coverage` flag** — fail CI if coverage below threshold: `apitool run --fail-on-coverage 80`
- **`--env-var` flag** — pass secrets from CI without env files: `apitool run --env-var "token=$API_TOKEN"`
- **GitHub Action** — `uses: kirrosh/apitool-action@v1` composite action (separate repo)

### One-shot test generation (`generate_and_save`)
New MCP tool that accepts spec path + optional endpoint filter and produces ready-to-save YAML test suites in one call. Eliminates the 3-step chain: `generate_tests_guide` → agent assembles YAML → `save_test_suite`.

---

## Medium Priority

### Batch `save_test_suite`
Accept an array of `{filePath, content}` pairs in a single call. Reduces token usage and round-trips for bulk generation.

### Split format guide from endpoint data
`generate_tests_guide` returns the full YAML format reference every call. Split into static format + dynamic endpoints, or cache format after first call.

### `apitool compare` command
Compare two test runs — regression detection in CI.

### Per-suite env resolution
When running `apitool run apis/` (directory with subdirs), resolve `.env.<name>.yaml` from each suite's directory, not from `dirname(path)`.

---

## Low Priority

### Summary after batch generation
After generating many suites, return a summary (created N files, total coverage %).

### Comment preservation
Parser preserves YAML comments when reading/writing (currently lost).

### `apitool docs` command
Generate markdown documentation from YAML tests: descriptions + examples.

### Multipart/form-data support
Runner support for file upload endpoints.

---

## Not Doing

| Item | Reason |
|------|--------|
| GraphQL / gRPC / WebSocket | REST + OpenAPI = 80% of market |
| Load testing | Use k6 instead |
| WebUI polish (themes, animations) | Not a selling point |
| Plugins / marketplace | Requires large team |
| Team features / RBAC | Different product category |
| Docker image | Single binary is simpler |
