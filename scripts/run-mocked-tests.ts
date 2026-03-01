/**
 * Runs each mock.module() test file in a separate Bun subprocess
 * to avoid Bun's module cache pollution bug (bun#7823, bun#12823).
 */

const MOCKED_FILES = [
  "tests/agent/tools/diagnose-failure.test.ts",
  "tests/agent/tools/explore-api.test.ts",
  "tests/agent/tools/generate-tests.test.ts",
  "tests/agent/tools/manage-environment.test.ts",
  "tests/agent/tools/query-results.test.ts",
  "tests/agent/tools/run-tests.test.ts",
  "tests/agent/tools/send-request.test.ts",
  "tests/agent/tools/validate-tests.test.ts",
  "tests/mcp/coverage-analysis.test.ts",
  "tests/mcp/explore-api.test.ts",
  "tests/mcp/send-request.test.ts",
  "tests/cli/request.test.ts",
  "tests/cli/coverage.test.ts",
];

const CONCURRENCY = 4;
let failed = 0;

async function runFile(file: string): Promise<boolean> {
  const proc = Bun.spawn(["bun", "test", file], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  const code = await proc.exited;
  return code === 0;
}

// Run in batches of CONCURRENCY
for (let i = 0; i < MOCKED_FILES.length; i += CONCURRENCY) {
  const batch = MOCKED_FILES.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(runFile));
  failed += results.filter((ok) => !ok).length;
}

if (failed > 0) {
  console.error(`\n${failed} mocked test file(s) failed.`);
  process.exit(1);
}
