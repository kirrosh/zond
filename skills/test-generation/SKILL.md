---
name: generate-api-tests
description: |
  Generate YAML test suites from OpenAPI spec for zond.
  Use when asked to: generate tests, create test coverage,
  write smoke tests, cover API endpoints.
context: fork
agent: Task
allowed-tools: [Read, Write, Bash(zond *), Bash(cat *)]
---

# Generate API Tests

## Step 1: Get spec overview
!`zond describe openapi.json --compact --json 2>/dev/null || echo '{"error":"no spec found"}'`

## Step 2: Check existing coverage
!`zond coverage --spec openapi.json --tests tests/ --json 2>/dev/null || echo '{"data":{"covered":[],"uncovered":"all"}}'`

## Your task

Based on the spec overview and coverage data above:

1. Identify uncovered endpoints
2. Group by tag
3. For each group, create a YAML test suite file

### Rules for test generation:
- One file per tag: `tests/<tag>-smoke.yaml`
- Start with GET endpoints only (tag: smoke)
- Use `{{base_url}}` for base URL
- Use `{{auth_token}}` for auth if security schemes present
- Add `capture` for IDs returned in responses
- Use generators for dynamic data: `{{$randomEmail}}`, `{{$uuid}}`
- Check response body structure matches spec schema
- Never invent endpoints not in spec

### After writing all files:
```bash
zond validate tests/
```

Report validation results. If errors, fix and re-validate.

Target: $ARGUMENTS
