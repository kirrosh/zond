# CI/CD Integration

Run apitool API tests automatically in your CI/CD pipeline.

## Quick Start

```bash
# Generate CI workflow for your project
apitool ci init            # auto-detect platform
apitool ci init --github   # GitHub Actions
apitool ci init --gitlab   # GitLab CI
```

## GitHub Actions

```yaml
name: API Tests
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch:

permissions:
  contents: read
  checks: write
  pull-requests: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install apitool
        run: curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh

      - name: Run tests
        run: |
          mkdir -p test-results
          apitool run apis/ --report junit --no-db > test-results/junit.xml
        continue-on-error: true

      - name: Publish test results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: test-results/junit.xml

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: test-results/junit.xml
```

> **Note:** `continue-on-error: true` ensures junit.xml is always written and published, even when tests fail (exit code 1). The `publish-unit-test-result-action` will set the check status based on test results.

## GitLab CI

```yaml
api-tests:
  image: ubuntu:latest
  before_script:
    - apt-get update -qq && apt-get install -y -qq curl
    - curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh
  script:
    - mkdir -p test-results
    - apitool run apis/ --report junit --no-db > test-results/junit.xml
  allow_failure:
    exit_codes: 1
  artifacts:
    when: always
    reports:
      junit: test-results/junit.xml
```

## Jenkins

```groovy
pipeline {
    agent any

    stages {
        stage('Install') {
            steps {
                sh 'curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh'
            }
        }
        stage('Test') {
            steps {
                sh 'mkdir -p test-results'
                sh 'apitool run apis/ --report junit --no-db > test-results/junit.xml || true'
            }
            post {
                always {
                    junit 'test-results/junit.xml'
                }
            }
        }
    }
}
```

## Generic Shell Script

Works with any CI system (CircleCI, Travis, Drone, etc.):

```bash
#!/bin/bash
set -uo pipefail

# Install apitool
curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh

# Run tests with JUnit output
mkdir -p test-results
apitool run apis/ --report junit --no-db > test-results/junit.xml
EXIT_CODE=$?

# Exit code: 0 = all passed, 1 = failures, 2 = error
exit $EXIT_CODE
```

## Environment Variables

`--env <name>` loads `.env.<name>.yaml` from the **test path directory** (`dirname` of the path passed to `apitool run`).

For example:
- `apitool run apis/petstore/tests/ --env ci` → looks for `apis/petstore/tests/.env.ci.yaml`
- `apitool run apis/ --env ci` → looks for `.env.ci.yaml` in current directory (parent of `apis/`)

If your env files live next to test files in subdirectories, run each API separately:

```bash
apitool run apis/petstore/tests/ --env default --report junit --no-db
```

Or place a `.env.yaml` (no name) in the repo root for shared variables.

### Secrets in CI

Pass secrets as environment variables and reference them in `.env.ci.yaml`:

```yaml
# .env.ci.yaml (in repo root or test directory)
base_url: https://api.staging.example.com
api_key: ${{ API_KEY }}
auth_token: ${{ AUTH_TOKEN }}
```

#### GitHub Actions

```yaml
- name: Run tests
  env:
    API_KEY: ${{ secrets.API_KEY }}
    AUTH_TOKEN: ${{ secrets.AUTH_TOKEN }}
  run: apitool run apis/ --env ci --report junit --no-db > test-results/junit.xml
```

#### GitLab CI

```yaml
api-tests:
  variables:
    API_KEY: $API_KEY  # Set in GitLab CI/CD settings
  script:
    - apitool run apis/ --env ci --report junit --no-db > test-results/junit.xml
```

### Auth token shortcut

For simple bearer token auth, use `--auth-token` instead of an env file:

```bash
apitool run apis/ --auth-token "$AUTH_TOKEN" --report junit --no-db
```

## Triggers

The generated workflow runs on push, PR, schedule, and manual dispatch by default. You can also trigger tests from external events.

### Schedule (cron)

Already included in the template. Adjust the cron expression:

```yaml
schedule:
  - cron: "0 */6 * * *"   # every 6 hours
  - cron: "0 9 * * 1-5"   # weekdays at 9am UTC
  - cron: "*/30 * * * *"  # every 30 minutes
```

### Trigger from another repo (GitHub)

Use `repository_dispatch` to trigger API tests when your backend repo deploys:

**In the test repo workflow** (already included in template):
```yaml
on:
  repository_dispatch:
    types: [api-updated]
```

**In the backend repo** — add a step after deploy:
```yaml
# .github/workflows/deploy.yml (backend repo)
- name: Trigger API tests
  run: |
    curl -X POST \
      -H "Authorization: token ${{ secrets.TEST_REPO_PAT }}" \
      -H "Accept: application/vnd.github.v3+json" \
      https://api.github.com/repos/OWNER/apitool-tests/dispatches \
      -d '{"event_type": "api-updated", "client_payload": {"env": "staging"}}'
```

Or with `gh` CLI:
```bash
gh api repos/OWNER/apitool-tests/dispatches \
  -f event_type=api-updated \
  -f 'client_payload[env]=staging'
```

> **Note:** Requires a Personal Access Token (PAT) with `repo` scope stored as a secret in the backend repo.

### Trigger from another repo (GitLab)

Use GitLab pipeline triggers:

```bash
curl -X POST \
  --form "ref=main" \
  --form "token=$TRIGGER_TOKEN" \
  "https://gitlab.com/api/v4/projects/PROJECT_ID/trigger/pipeline"
```

Add the trigger token in GitLab: Settings → CI/CD → Pipeline triggers.

### Webhook from external service

Any service that can send HTTP POST requests can trigger tests:

**GitHub:** Use `repository_dispatch` (see above)

**GitLab:** Use pipeline trigger tokens

**Generic (any CI):** Use the CI platform's API to trigger a build. Example with GitHub CLI:

```bash
gh workflow run api-tests.yml --repo OWNER/apitool-tests
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | All tests passed |
| 1    | One or more tests failed |
| 2    | Configuration or runtime error |

## Key Flags for CI

| Flag | Description |
|------|-------------|
| `--report junit` | Output JUnit XML for CI integration |
| `--no-db` | Skip writing to local SQLite database |
| `--env <name>` | Load `.env.<name>.yaml` from test path directory |
| `--bail` | Stop on first suite failure |
| `--safe` | Run only GET tests (read-only mode) |
| `--tag <tag>` | Filter suites by tag |
| `--auth-token <token>` | Inject bearer token as `{{auth_token}}` |
