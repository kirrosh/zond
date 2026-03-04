---
name: ci-setup
description: This skill should be used when the user asks to "add API tests to CI", "create GitHub Actions workflow for API tests", "set up GitLab CI for apitool", "automate API test execution in CI/CD pipeline", or "add continuous testing".
---

# CI/CD Setup for API Tests

Set up automated API test execution in CI/CD pipelines.

## Prerequisites

- API tests must already exist and pass locally
- Project must use GitHub or GitLab for CI

## Workflow

### Step 1 — Verify Tests Exist

```
query_db(action: "list_collections")
```

Ensure you have at least one registered API with passing tests. If not, use the api-test-generation skill first.

### Step 2 — Check Coverage

```
coverage_analysis(specPath: "<spec>", testsDir: "<tests-dir>")
```

Review the coverage percentage. Recommended minimum for CI: 60%.

### Step 3 — Generate CI Configuration

```
ci_init()
```

This auto-detects the CI platform:
- `.github/` directory exists → GitHub Actions
- `.gitlab-ci.yml` exists → GitLab CI
- Neither → defaults to GitHub Actions

Force a specific platform with the `platform` parameter:
```
ci_init(platform: "gitlab")
```

### Step 4 — Configure Secrets

The generated workflow expects these environment variables as CI secrets:

| Secret | Description | Required |
|--------|-------------|----------|
| `APITOOL_BASE_URL` | Base URL of the API to test | Yes |
| `APITOOL_AUTH_TOKEN` | Authentication token | If API requires auth |

**GitHub Actions:** Go to repo Settings > Secrets and variables > Actions > New repository secret.

**GitLab CI:** Go to Settings > CI/CD > Variables > Add variable (mark as "Masked").

### Step 5 — Understand the Generated Workflow

The workflow includes:

**Triggers:**
- `push` to main/master branch
- `pull_request` targeting main/master
- `schedule` — daily cron run for regression detection
- `repository_dispatch` — for external triggers
- `workflow_dispatch` — manual trigger

**Jobs:**

1. **Smoke tests** (runs on every trigger):
   ```bash
   apitool run tests/ --safe --tag smoke
   ```
   GET-only, safe for production APIs.

2. **Full test suite** (runs on schedule and manual trigger):
   ```bash
   apitool run tests/ --tag crud --env-var BASE_URL=$APITOOL_BASE_URL
   ```

3. **Coverage gate**:
   ```bash
   apitool coverage --spec openapi.json --tests tests/ --fail-on-coverage 60
   ```
   Fails the pipeline if coverage drops below 60%.

### Step 6 — Commit and Push

After reviewing the generated workflow file, commit it to the repository. The CI pipeline will activate on the next push or PR.

## Tips

- Start with smoke tests only (`--safe --tag smoke`) — they're safe to run against production
- Add CRUD tests to CI only when you have a dedicated test environment
- Use `--fail-on-coverage` to prevent coverage regression
- Use `--env-var` to inject secrets from CI environment variables
- Schedule daily runs to catch API regressions early
