import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";

const ZOND = ["bun", "run", "src/cli/index.ts"];

describe("TASK-89: exit-code taxonomy", () => {
  test("usage error → exit 2 (no [zond:internal] prefix)", () => {
    const out = spawnSync(ZOND[0]!, [...ZOND.slice(1), "run", "/definitely/not/a/path-zztest"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(out.status).toBe(2);
    const stderr = out.stderr;
    expect(stderr).not.toContain("[zond:internal]");
  });

  test("unknown subcommand → exit 2 (commander)", () => {
    const out = spawnSync(ZOND[0]!, [...ZOND.slice(1), "this-command-does-not-exist"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(out.status).toBe(2);
    expect(out.stderr).not.toContain("[zond:internal]");
  });

  // Note: triggering an actual uncaught throw inside zond requires injecting a
  // bug; we cover the prefix path with a unit test on reportInternalError if
  // exposed. The contract above (exit 2 for usage, no [zond:internal] noise on
  // expected errors) is the user-visible regression guarantee from this task.
});
