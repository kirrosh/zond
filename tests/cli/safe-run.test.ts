import { describe, test, expect, afterEach, beforeEach, mock } from "bun:test";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { unlinkDb as tryUnlink } from "../_helpers/tmp-db";
import { mockFetchSequence as mockFetchResponses, restoreFetch } from "../_helpers/fetch-mock";

const FIXTURES = `${import.meta.dir}/../fixtures`;

describe("--safe mode", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = captureOutput().restore;
  });

  afterEach(() => {
    restore();
    restoreFetch();
    closeDb();
  });

  test("safe mode runs only GET tests from crud suite", async () => {
    // crud.yaml has POST, GET, DELETE — safe mode should only run GET
    mockFetchResponses([
      { status: 200, body: { id: 1, name: "John", email: "john@test.com" } },
    ]);

    const code = await runCommand({
      paths: [`${FIXTURES}/crud.yaml`],
      env: undefined,
      // Pre-seed fixtures normally captured by the (skipped) POST step so the
      // GET step's path is resolvable in safe mode.
      envVars: ["base=http://localhost", "token=t", "user_id=42"],
      report: "json",
      bail: false,
      noDb: true,
      safe: true,
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    // Only the GET test should have run (1 call)
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  test("safe mode with GET-only suite runs normally", async () => {
    // simple.yaml has only GET /health
    mockFetchResponses([
      { status: 200, body: { status: "ok" } },
    ]);

    const code = await runCommand({
      paths: [`${FIXTURES}/simple.yaml`],
      report: "json",
      bail: false,
      noDb: true,
      safe: true,
    });

    expect(code).toBe(0);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  test("safe mode returns 0 when no GET tests found", async () => {
    const code = await runCommand({
      paths: [`${FIXTURES}/post-only.yaml`],
      report: "console",
      bail: false,
      noDb: true,
      safe: true,
    });

    // Should return 0 (warning printed but no error)
    expect(code).toBe(0);
  });
});
