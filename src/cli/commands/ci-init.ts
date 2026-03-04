import { resolve, dirname } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { printSuccess, printError } from "../output.ts";

export interface CiInitOptions {
  platform?: "github" | "gitlab";
  force: boolean;
  dir?: string;
}

const GH_ACTIONS_TEMPLATE = `name: API Tests
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch:
  repository_dispatch:
    types: [api-updated]

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

      - name: Check coverage
        run: zond coverage --api myapi --fail-on-coverage 60
        # Fails if coverage drops below 60% — adjust threshold as needed

      - name: Run smoke tests (read-only, safe for production)
        run: |
          mkdir -p test-results
          zond run apis/ --tag smoke --safe --report junit --no-db > test-results/smoke.xml
          # Use --env-var "API_KEY=\${{ secrets.API_KEY }}" to inject secrets without writing to disk
        continue-on-error: true

      - name: Run CRUD tests (staging only)
        run: |
          zond run apis/ --tag crud --env staging --report junit --no-db > test-results/crud.xml
          # Add --env-var "BASE_URL=\${{ secrets.STAGING_URL }}" for staging URL
        continue-on-error: true

      - name: Publish test results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: test-results/*.xml

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: test-results/
`;

const GITLAB_CI_TEMPLATE = `# Trigger via API: curl -X POST --form ref=main --form token=TRIGGER_TOKEN $CI_API_V4_URL/projects/$CI_PROJECT_ID/trigger/pipeline

variables:
  # Set API_KEY in GitLab CI/CD → Settings → Variables
  API_KEY: ""

api-coverage:
  image: ubuntu:latest
  before_script:
    - apt-get update -qq && apt-get install -y -qq curl
    - curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh
  script:
    - zond coverage --api myapi --fail-on-coverage 60

api-smoke:
  image: ubuntu:latest
  before_script:
    - apt-get update -qq && apt-get install -y -qq curl
    - curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh
  script:
    - mkdir -p test-results
    # Use --env-var to inject secrets without writing to disk
    - zond run apis/ --tag smoke --safe --report junit --no-db --env-var "API_KEY=$API_KEY" > test-results/smoke.xml
  allow_failure:
    exit_codes: 1
  artifacts:
    when: always
    reports:
      junit: test-results/smoke.xml

api-crud:
  image: ubuntu:latest
  before_script:
    - apt-get update -qq && apt-get install -y -qq curl
    - curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh
  script:
    - mkdir -p test-results
    - zond run apis/ --tag crud --env staging --report junit --no-db > test-results/crud.xml
  allow_failure:
    exit_codes: 1
  artifacts:
    when: always
    reports:
      junit: test-results/crud.xml
`;

function writeIfMissing(filePath: string, content: string, force: boolean): boolean {
  if (!force && existsSync(filePath)) {
    console.log(`  Skipped ${filePath} (already exists, use --force to overwrite)`);
    return false;
  }
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, "utf-8");
  console.log(`  Created ${filePath}`);
  return true;
}

function detectPlatform(cwd: string): "github" | "gitlab" | undefined {
  if (existsSync(resolve(cwd, ".github"))) return "github";
  if (existsSync(resolve(cwd, ".gitlab-ci.yml"))) return "gitlab";
  return undefined;
}

export async function ciInitCommand(options: CiInitOptions): Promise<number> {
  const cwd = options.dir ? resolve(options.dir) : process.cwd();
  let platform = options.platform;

  if (!platform) {
    platform = detectPlatform(cwd);
    if (!platform) {
      platform = "github";
      console.log("No CI platform detected, defaulting to GitHub Actions.\n");
    } else {
      console.log(`Detected ${platform === "github" ? "GitHub Actions" : "GitLab CI"}.\n`);
    }
  }

  console.log(`Generating ${platform === "github" ? "GitHub Actions" : "GitLab CI"} workflow...\n`);

  let created = false;

  if (platform === "github") {
    const targetPath = resolve(cwd, ".github/workflows/api-tests.yml");
    created = writeIfMissing(targetPath, GH_ACTIONS_TEMPLATE, options.force);
  } else {
    const targetPath = resolve(cwd, ".gitlab-ci.yml");
    created = writeIfMissing(targetPath, GITLAB_CI_TEMPLATE, options.force);
  }

  if (created) {
    printSuccess("CI workflow created. Commit and push to activate.");
  }

  return 0;
}
