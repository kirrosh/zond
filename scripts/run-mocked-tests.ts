/**
 * Runs each mock.module() test file in a separate Bun subprocess
 * to avoid Bun's module cache pollution bug (bun#7823, bun#12823).
 */

// Files that use mock.module() — must run in separate subprocesses
// to avoid Bun's module cache pollution bug (bun#7823, bun#12823).
// These files live in tests/mocked/ and do NOT end in .test.ts so that
// plain `bun test` does not auto-discover and run them in-process.
const MOCKED_FILES = [
  "tests/mocked/coverage.ts",
];

const CONCURRENCY = 4;
let failed = 0;

async function runFile(file: string): Promise<boolean> {
  const proc = Bun.spawn(["bun", "test", `./${file}`], {
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
