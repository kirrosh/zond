import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { CommanderError } from "commander";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildProgram, preprocessArgv } from "../../src/cli/program.ts";

// Suppress commander stdout/stderr (--help, errors)
function suppressOutput(): () => void {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  return () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
}

// Parse argv synchronously by extracting the action call. We don't actually invoke action;
// instead we read the command tree and parsed options. parseAsync would call the real handlers.
async function tryParse(argv: string[]): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const program = buildProgram();
  const restore = suppressOutput();
  try {
    await program.parseAsync(["bun", "script.ts", ...argv]);
    return { ok: true };
  } catch (err) {
    if (err instanceof CommanderError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  } finally {
    restore();
  }
}

describe("preprocessArgv (MSYS path fix)", () => {
  test("strips MSYS prefix from --path value (separated form)", () => {
    const out = preprocessArgv([
      "bun", "script.ts", "describe", "spec.json",
      "--path", "C:/Program Files/Git/users",
    ]);
    expect(out[5]).toBe("/users");
  });

  test("strips MSYS prefix from --path=value form", () => {
    const out = preprocessArgv([
      "bun", "script.ts", "describe", "spec.json",
      "--path=C:/Program Files/Git/users",
    ]);
    expect(out[4]).toBe("--path=/users");
  });

  test("strips MSYS prefix from --json-path value", () => {
    const out = preprocessArgv([
      "bun", "script.ts", "request", "GET", "https://api/x",
      "--json-path", "C:/Program Files/Git/data/items",
    ]);
    expect(out[6]).toBe("/data/items");
  });

  test("does not touch unrelated flags", () => {
    const before = ["bun", "script.ts", "run", "tests/", "--env", "C:/Program Files/Git/staging"];
    const after = preprocessArgv(before);
    expect(after).toEqual(before);
  });

  test("does not touch already-clean paths", () => {
    const out = preprocessArgv(["bun", "script.ts", "describe", "spec.json", "--path", "/users"]);
    expect(out[5]).toBe("/users");
  });

  test("handles other MSYS prefixes (msys64, usr)", () => {
    expect(preprocessArgv(["bun", "x", "describe", "s", "--path", "C:/msys64/users"])[5]).toBe("/users");
    expect(preprocessArgv(["bun", "x", "describe", "s", "--path", "D:\\usr\\products"])[5]).toBe("/products");
  });
});

describe("buildProgram — registration", () => {
  test("does not register 'ui' command", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).not.toContain("ui");
    expect(names).toContain("serve");
  });

  test("registers all user-facing commands", () => {
    const program = buildProgram();
    const names = new Set(program.commands.map((c) => c.name()));
    for (const expected of [
      "run", "validate", "serve", "ci", "coverage", "init",
      "describe", "db", "request", "generate", "catalog", "guide",
      "export", "update", "sync", "mcp",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  test("update command has self-update alias", () => {
    const program = buildProgram();
    const updateCmd = program.commands.find((c) => c.name() === "update");
    expect(updateCmd?.aliases()).toContain("self-update");
  });

  test("db has 5 nested subcommands", () => {
    const program = buildProgram();
    const db = program.commands.find((c) => c.name() === "db");
    expect(db).toBeDefined();
    const dbSubs = new Set(db!.commands.map((c) => c.name()));
    for (const expected of ["collections", "runs", "run", "diagnose", "compare"]) {
      expect(dbSubs.has(expected)).toBe(true);
    }
  });

  test("export has postman subcommand", () => {
    const program = buildProgram();
    const exp = program.commands.find((c) => c.name() === "export");
    expect(exp?.commands.map((c) => c.name())).toContain("postman");
  });

  test("ci has init subcommand", () => {
    const program = buildProgram();
    const ci = program.commands.find((c) => c.name() === "ci");
    expect(ci?.commands.map((c) => c.name())).toContain("init");
  });

  test("mcp has start subcommand", () => {
    const program = buildProgram();
    const mcp = program.commands.find((c) => c.name() === "mcp");
    expect(mcp).toBeDefined();
    expect(mcp!.commands.map((c) => c.name())).toContain("start");
  });
});

describe("buildProgram — repeatable flags", () => {
  // The run action fires (with no path) and prints to stderr — suppress it for cleaner output.
  test("collects multiple --tag values", () => {
    const restore = suppressOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--tag", "a", "--tag", "b"], { from: "user" });
    restore();
    expect(runCmd.opts().tag).toEqual(["a", "b"]);
  });

  test("collects --exclude-tag values", () => {
    const restore = suppressOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--exclude-tag", "x", "--exclude-tag", "y"], { from: "user" });
    restore();
    expect(runCmd.opts().excludeTag).toEqual(["x", "y"]);
  });

  test("collects --env-var values", () => {
    const restore = suppressOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--env-var", "K1=V1", "--env-var", "K2=V2"], { from: "user" });
    restore();
    expect(runCmd.opts().envVar).toEqual(["K1=V1", "K2=V2"]);
  });

  test("collects multiple --header values for request", async () => {
    const program = buildProgram();
    const reqCmd = program.commands.find((c) => c.name() === "request")!;
    // request <method> <url> are required positionals — supply dummies so the
    // option parser accepts the run. Mock fetch so the action's HTTP call resolves
    // (otherwise we'd leak an unhandled rejection that fails the suite).
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as unknown as typeof fetch;
    const restore = suppressOutput();
    try {
      await reqCmd.parseAsync(
        ["GET", "http://test.invalid", "--header", "A: 1", "--header", "B: 2"],
        { from: "user" },
      );
    } catch { /* opts already captured */ }
    restore();
    globalThis.fetch = origFetch;
    expect(reqCmd.opts().header).toEqual(["A: 1", "B: 2"]);
  });

  test("--tag accepts comma-separated form (split happens in action via flatSplit)", () => {
    // Commander itself doesn't split — we test that the raw value is preserved as one entry.
    // The splitting is handled by flatSplit in the action; we cover that via end-to-end below.
    const restore = suppressOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--tag=a,b"], { from: "user" });
    restore();
    expect(runCmd.opts().tag).toEqual(["a,b"]);
  });
});

describe("buildProgram — numeric validations (exit 2 via CommanderError)", () => {
  test("--timeout=abc rejects with exit 2", async () => {
    const result = await tryParse(["run", "tests/", "--timeout", "abc"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--port=0 rejects with exit 2", async () => {
    const result = await tryParse(["serve", "--port", "0"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--fail-on-coverage=150 rejects (out of range)", async () => {
    const result = await tryParse([
      "coverage", "--spec", "x.json", "--tests", "y/", "--fail-on-coverage", "150",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--report=invalid rejects", async () => {
    const result = await tryParse(["run", "tests/", "--report", "invalid"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--rate-limit=abc rejects with exit 2", async () => {
    const result = await tryParse(["run", "tests/", "--rate-limit", "abc"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--rate-limit=0 rejects with exit 2", async () => {
    const result = await tryParse(["run", "tests/", "--rate-limit", "0"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });
});

describe("buildProgram — unknown command", () => {
  test("foobar surfaces commander.unknownCommand", async () => {
    const result = await tryParse(["foobar"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.unknownCommand");
  });

  test("'ui' is treated as unknown command (alias was removed)", async () => {
    const result = await tryParse(["ui"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.unknownCommand");
  });
});

describe("T15: zond use → zond run resolves --api from .zond-current", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "zond-current-e2e-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(cwd, { recursive: true, force: true });
  });

  async function parseCapturingErr(argv: string[]): Promise<string> {
    const captureErr: string[] = [];
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = mock(() => true) as typeof process.stdout.write;
    process.stderr.write = mock((data: any) => {
      captureErr.push(String(data));
      return true;
    }) as typeof process.stderr.write;
    try {
      const program = buildProgram();
      await program.parseAsync(["bun", "script.ts", ...argv]);
    } catch { /* CommanderError or action errors already in captureErr */ }
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    return captureErr.join("");
  }

  test("`zond run` (no args, no --api) falls back to .zond-current and tries to resolve it", async () => {
    writeFileSync(join(cwd, ".zond-current"), "definitely-not-a-real-api\n", "utf-8");
    const stderr = await parseCapturingErr(["run", "--db", join(cwd, "zond.db")]);
    // The collection lookup must have been attempted with the .zond-current value —
    // i.e. we reached "API '...' not found", not "Missing path argument".
    expect(stderr).toContain("definitely-not-a-real-api");
    expect(stderr).not.toContain("Missing path argument");
  });

  test("explicit path bypasses .zond-current fallback", async () => {
    writeFileSync(join(cwd, ".zond-current"), "definitely-not-a-real-api\n", "utf-8");
    const stderr = await parseCapturingErr(["run", "/no/such/dir", "--db", join(cwd, "zond.db")]);
    expect(stderr).not.toContain("definitely-not-a-real-api");
  });
});
