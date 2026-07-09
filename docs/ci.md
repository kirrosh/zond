# CI/CD Integration

Run zond API tests automatically in your CI/CD pipeline.

## Quick Start

```bash
# Generate CI workflow for your project
zond ci init            # auto-detect platform
zond ci init --github   # GitHub Actions
zond ci init --gitlab   # GitLab CI
```

## CI mode: `zond run --all` (TASK-116)

CI almost always wants **one stored run per build**, even when the
workspace registers multiple APIs. `zond run --all` walks every registered
API, executes its `tests/` directory, and folds the results into a single
`runs.id` row. Combined with auto-detected CI context this gives a
queryable, comparable history without per-API bookkeeping.

```bash
zond run --all --report junit --report-out test-results/junit.xml
```

Auto-detected env vars (no flags needed):

| Variable | Effect |
|---|---|
| `ZOND_TRIGGER` | Stamps `runs.trigger` (`ci`, `manual`, …). `--all` defaults this to `ci` |
| `ZOND_COMMIT_SHA` | Stamps `runs.commit_sha` for `db compare` regression diffs |
| `ZOND_BRANCH` | Stamps `runs.branch` |
| `ZOND_SESSION_ID` | Group multiple `zond run` calls (e.g. tests + probes) under one campaign for `coverage --union session` |

`zond audit --api <name>` runs the full pipeline (prepare-fixtures →
generate → probes → run → coverage → HTML) for nightly/scheduled CI jobs
where breadth matters more than wall-clock time (TASK-262).

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

      - name: Install zond
        run: curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh

      - name: Run tests
        run: |
          mkdir -p test-results
          zond run apis/ --report junit --no-db > test-results/junit.xml
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
    - curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh
  script:
    - mkdir -p test-results
    - zond run apis/ --report junit --no-db > test-results/junit.xml
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
                sh 'curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh'
            }
        }
        stage('Test') {
            steps {
                sh 'mkdir -p test-results'
                sh 'zond run apis/ --report junit --no-db > test-results/junit.xml || true'
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

# Install zond
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh

# Run tests with JUnit output
mkdir -p test-results
zond run apis/ --report junit --no-db > test-results/junit.xml
EXIT_CODE=$?

# Exit code: 0 = all passed, 1 = failures, 2 = error
exit $EXIT_CODE
```

## Environment Variables

`--env <name>` loads `.env.<name>.yaml` from the **test path directory** (`dirname` of the path passed to `zond run`).

For example:
- `zond run apis/petstore/tests/ --env ci` → looks for `apis/petstore/tests/.env.ci.yaml`
- `zond run apis/ --env ci` → looks for `.env.ci.yaml` in current directory (parent of `apis/`)

If your env files live next to test files in subdirectories, run each API separately:

```bash
zond run apis/petstore/tests/ --env default --report junit --no-db
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
  run: zond run apis/ --env ci --report junit --no-db > test-results/junit.xml
```

#### GitLab CI

```yaml
api-tests:
  variables:
    API_KEY: $API_KEY  # Set in GitLab CI/CD settings
  script:
    - zond run apis/ --env ci --report junit --no-db > test-results/junit.xml
```

### Auth token shortcut

For simple bearer token auth, use `--auth-token` instead of an env file:

```bash
zond run apis/ --auth-token "$AUTH_TOKEN" --report junit --no-db
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
      https://api.github.com/repos/OWNER/zond-tests/dispatches \
      -d '{"event_type": "api-updated", "client_payload": {"env": "staging"}}'
```

Or with `gh` CLI:
```bash
gh api repos/OWNER/zond-tests/dispatches \
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
gh workflow run api-tests.yml --repo OWNER/zond-tests
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | All tests passed |
| 1    | One or more tests failed |
| 2    | Configuration or runtime error (usage / spec / fixture / I/O) |
| 3    | Internal zond error — uncaught throw (file an issue) |
| ≥128 | Killed by signal — typically `137` (SIGKILL: OOM or Gatekeeper on macOS) or `143` (SIGTERM) |

See `zond` exit-code taxonomy in [ZOND.md](../ZOND.md#exit-codes) for the
full table.

## Key Flags for CI

| Flag | Description |
|------|-------------|
| `--all` | Run every registered API in one stored run (CI canonical) |
| `--report junit` | Output JUnit XML for CI integration |
| `--report-out <file>` | Write the report to a file instead of stdout |
| `--no-db` | Skip writing to local SQLite database (or keep it for `db compare` history) |
| `--env <name>` | Load `.env.<name>.yaml` from test path directory |
| `--bail` | Stop on first suite failure |
| `--safe` | Run only GET tests (read-only mode) |
| `--tag <tag>` / `--exclude-tag <tag>` | Filter suites by tag |
| `--auth-token <token>` | Inject bearer token as `{{auth_token}}` |
| `--rate-limit auto` | Throttle from `Retry-After` / `X-RateLimit-*` headers (TASK-81) |
| `--quiet` | Suppress per-step output, keep summary + report |

## Building for distribution (macOS)

`bun run build` compiles `./zond` and, on macOS, applies an **adhoc**
codesign so Gatekeeper doesn't SIGKILL the freshly-built binary on first
run (`code or signature have been modified`). Adhoc is enough for local
development but **not for distribution**: users on other Macs will hit
Gatekeeper rejection.

For published release artefacts (Homebrew, install.sh tarballs, GitHub
Releases) re-sign with a real Developer ID + notarisation:

```bash
codesign --force --options runtime --sign "Developer ID Application: <Team>" ./zond
xcrun notarytool submit ./zond.zip --apple-id <id> --team-id <team> --wait
xcrun stapler staple ./zond
```

CI release jobs that produce macOS binaries should run those steps
after `bun run build`. The local adhoc step is a no-op on linux/windows
and degrades gracefully (warn-only) when `codesign` isn't on PATH.

> **Why install.sh re-signs after `cp`.** macOS attaches a
> `com.apple.provenance` extended attribute to any file copied via `cp`
> (and `com.apple.quarantine` to anything downloaded). Both invalidate
> the adhoc signature baked into the build, and the kernel SIGKILL's the
> binary on first execution with exit `137` and no diagnostic. `install.sh`
> strips xattrs (`xattr -c`) and re-signs (`codesign --force --sign -`)
> in place — without that, the binary works in the build directory but
> dies as soon as it's installed.

## Release pipeline (one run per tag)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which does the
whole distribution pass in one go — no manual per-arch assembly:

1. **build** (matrix): cross-compiles all 5 targets with
   `bun build --compile --target=...` — `darwin-{arm64,x64}`,
   `linux-{x64,arm64}`, `win-x64` — and adhoc-codesigns the darwin ones.
   Each target uploads a `tar.gz`/`zip` archive **and** a raw binary
   (used by the npm postinstall).
2. **release**: computes `checksums.txt` over every artifact, attaches
   everything to the GitHub Release. The brew-bump step (regenerate
   `Formula/zond.rb` via `scripts/release/generate-brew-formula.mjs`,
   push to `kirrosh/homebrew-tap`) self-skips while `TAP_GITHUB_TOKEN`
   is unset — the brew channel is deferred until first users (ARV-387).
3. **publish**: `npm publish` of the thin launcher package; node-only
   users get the platform binary via `scripts/npm/postinstall.mjs`
   (checksum-verified against `checksums.txt`).

So the release command is just:

```bash
git tag v0.X.Y && git push origin v0.X.Y
```
