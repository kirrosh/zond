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

      - name: Install apitool
        run: curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh

      - name: Run tests
        run: |
          mkdir -p test-results
          apitool run apis/ --report junit --no-db > test-results/junit.xml
          # Add --env <name> to load .env.<name>.yaml from test directory
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
`;

const GITLAB_CI_TEMPLATE = `# Trigger via API: curl -X POST --form ref=main --form token=TRIGGER_TOKEN $CI_API_V4_URL/projects/$CI_PROJECT_ID/trigger/pipeline

api-tests:
  image: ubuntu:latest
  before_script:
    - apt-get update -qq && apt-get install -y -qq curl
    - curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh
  script:
    - mkdir -p test-results
    - apitool run apis/ --report junit --no-db > test-results/junit.xml
    # Add --env <name> to load .env.<name>.yaml from test directory
  allow_failure:
    exit_codes: 1
  artifacts:
    when: always
    reports:
      junit: test-results/junit.xml
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

function detectPlatform(cwd: string): "github" | "gitlab" | null {
  if (existsSync(resolve(cwd, ".github"))) return "github";
  if (existsSync(resolve(cwd, ".gitlab-ci.yml"))) return "gitlab";
  return null;
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
